import Foundation
import SwiftUI
import UIKit

actor BeachcarImagePipeline {
  static let shared = BeachcarImagePipeline()

  private let decodedImages = NSCache<NSURL, UIImage>()

  private init() {
    decodedImages.countLimit = 180
    decodedImages.totalCostLimit = 80 * 1024 * 1024
  }

  static func configureSharedCache() {
    URLCache.shared = URLCache(
      memoryCapacity: 64 * 1024 * 1024,
      diskCapacity: 256 * 1024 * 1024,
      diskPath: "beachcar-image-cache"
    )
  }

  func image(for url: URL) async throws -> UIImage {
    let cacheKey = url as NSURL
    if let image = decodedImages.object(forKey: cacheKey) {
      return image
    }

    let request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 20)
    if let cached = URLCache.shared.cachedResponse(for: request),
       let image = UIImage(data: cached.data) {
      decodedImages.setObject(image, forKey: cacheKey, cost: cached.data.count)
      return image
    }

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw ImagePipelineError.badResponse
    }
    guard let image = UIImage(data: data) else {
      throw ImagePipelineError.decodeFailed
    }

    URLCache.shared.storeCachedResponse(CachedURLResponse(response: response, data: data), for: request)
    decodedImages.setObject(image, forKey: cacheKey, cost: data.count)
    return image
  }

  func prefetch(_ urls: [URL]) async {
    let uniqueUrls = Array(Set(urls)).prefix(24)
    await withTaskGroup(of: Void.self) { group in
      for url in uniqueUrls {
        group.addTask(priority: .utility) {
          _ = try? await self.image(for: url)
        }
      }
    }
  }
}

enum ImagePipelineError: Error {
  case badResponse
  case decodeFailed
}

struct CachedRemoteImage<Content: View, Placeholder: View, Failure: View>: View {
  let url: URL?
  let content: (Image) -> Content
  let placeholder: () -> Placeholder
  let failure: () -> Failure

  @StateObject private var loader = CachedRemoteImageLoader()

  init(
    url: URL?,
    @ViewBuilder content: @escaping (Image) -> Content,
    @ViewBuilder placeholder: @escaping () -> Placeholder,
    @ViewBuilder failure: @escaping () -> Failure
  ) {
    self.url = url
    self.content = content
    self.placeholder = placeholder
    self.failure = failure
  }

  var body: some View {
    Group {
      if let image = loader.image {
        content(Image(uiImage: image))
      } else if loader.failed {
        failure()
      } else {
        placeholder()
      }
    }
    .task(id: url) {
      await loader.load(url)
    }
  }
}

@MainActor
private final class CachedRemoteImageLoader: ObservableObject {
  @Published var image: UIImage?
  @Published var failed = false

  func load(_ url: URL?) async {
    image = nil
    failed = false
    guard let url else {
      failed = true
      return
    }
    do {
      image = try await BeachcarImagePipeline.shared.image(for: url)
    } catch {
      failed = true
    }
  }
}
