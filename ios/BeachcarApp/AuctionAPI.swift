import Foundation

struct AuctionAPI {
  typealias TokenProvider = () async throws -> String?

  let baseURL: URL

  enum ImageVariant: String {
    case thumb
    case deck
    case full
  }

  func me(authToken: String?) async throws -> UserPayload {
    try await request(path: "/api/me", authToken: authToken)
  }

  func acceptInvite(code: String, authToken: String?) async throws -> UserPayload {
    try await request(
      path: "/api/invites/accept",
      method: "POST",
      body: InviteAcceptRequest(code: code),
      authToken: authToken
    )
  }

  func putProfile(input: ProfileInput, authToken: String?) async throws -> UserPayload {
    try await request(path: "/api/profile", method: "PUT", body: input, authToken: authToken)
  }

  func putSourceSettings(input: SourceSettingsRequest, authToken: String?) async throws -> UserPayload {
    try await request(path: "/api/source-settings", method: "PUT", body: input, authToken: authToken)
  }

  func putResearchSettings(input: ResearchSettingsRequest, authToken: String?) async throws -> UserPayload {
    try await request(path: "/api/research-settings", method: "PUT", body: input, authToken: authToken)
  }

  func latestRun(authToken: String?) async throws -> RunPayload {
    try await request(path: "/api/runs/latest", authToken: authToken)
  }

  func latestAgentRun(authToken: String?) async throws -> AgentRunRecord? {
    try await request(path: "/api/agent-runs/latest", authToken: authToken)
  }

  func putFeedback(
    listingKey: String,
    action: FeedbackAction,
    note: String? = nil,
    tags: [String] = [],
    authToken: String?
  ) async throws -> FeedbackRecord {
    try await request(
      path: "/api/feedback/\(listingKey.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? listingKey)",
      method: "PUT",
      body: FeedbackRequest(action: action.rawValue, note: note, tags: tags),
      authToken: authToken
    )
  }

  func deleteFeedback(listingKey: String, authToken: String?) async throws {
    let _: EmptyResponse = try await request(
      path: "/api/feedback/\(listingKey.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? listingKey)",
      method: "DELETE",
      authToken: authToken
    )
  }

  func preferenceEvent(
    listingKey: String?,
    eventType: String,
    note: String?,
    transcript: String?,
    tags: [String],
    authToken: String?
  ) async throws -> PreferenceEvent {
    try await request(
      path: "/api/preference-events",
      method: "POST",
      body: PreferenceEventRequest(listingKey: listingKey, eventType: eventType, note: note, transcript: transcript, tags: tags),
      authToken: authToken
    )
  }

  func postProductEvents(_ events: [QueuedProductEvent], authToken: String?) async throws -> ProductEventBatchResponse {
    try await request(
      path: "/api/product-events/batch",
      method: "POST",
      body: ProductEventBatchRequest(events: events),
      authToken: authToken
    )
  }

  func productTuningConfig(authToken: String?) async throws -> ProductTuningConfig {
    try await request(path: "/api/product-tuning-config", authToken: authToken)
  }

  func resolvedImageURL(_ value: String, variant: ImageVariant? = nil) -> URL? {
    let url: URL?
    if value.hasPrefix("/") {
      url = URL(string: value, relativeTo: baseURL)?.absoluteURL
    } else {
      url = URL(string: value)
    }
    guard let url else { return nil }
    guard let variant, url.path.hasPrefix("/api/images/"), var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      return url
    }
    var items = components.queryItems?.filter { $0.name != "variant" } ?? []
    items.append(URLQueryItem(name: "variant", value: variant.rawValue))
    components.queryItems = items
    return components.url ?? url
  }

  private func request<T: Decodable, Body: Encodable>(
    path: String,
    method: String = "GET",
    body: Body?,
    authToken: String?
  ) async throws -> T {
    var request = URLRequest(url: URL(string: path, relativeTo: baseURL)!.absoluteURL)
    request.httpMethod = method
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    if let token = authToken {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONEncoder().encode(body)
    }

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw APIError.transport("No HTTP response")
    }
    guard (200..<300).contains(http.statusCode) else {
      let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data).error) ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
      throw APIError.http(status: http.statusCode, message: message)
    }
    if T.self == EmptyResponse.self {
      return EmptyResponse() as! T
    }
    do {
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      throw APIError.transport(Self.describeDecodeError(error))
    }
  }

  private func request<T: Decodable>(
    path: String,
    method: String = "GET",
    authToken: String?
  ) async throws -> T {
    try await request(path: path, method: method, body: Optional<EmptyBody>.none, authToken: authToken)
  }
}

private extension AuctionAPI {
  static func describeDecodeError(_ error: Error) -> String {
    switch error {
    case let DecodingError.typeMismatch(type, context):
      "Could not decode \(type) at \(codingPath(context.codingPath)): \(context.debugDescription)"
    case let DecodingError.valueNotFound(type, context):
      "Missing \(type) at \(codingPath(context.codingPath)): \(context.debugDescription)"
    case let DecodingError.keyNotFound(key, context):
      "Missing key \(key.stringValue) at \(codingPath(context.codingPath)): \(context.debugDescription)"
    case let DecodingError.dataCorrupted(context):
      "Corrupt data at \(codingPath(context.codingPath)): \(context.debugDescription)"
    default:
      error.localizedDescription
    }
  }

  static func codingPath(_ path: [CodingKey]) -> String {
    let value = path.map(\.stringValue).joined(separator: ".")
    return value.isEmpty ? "<root>" : value
  }
}

enum APIError: LocalizedError {
  case http(status: Int, message: String)
  case transport(String)

  var errorDescription: String? {
    switch self {
    case .http(_, let message): message
    case .transport(let message): message
    }
  }
}

private struct FeedbackRequest: Encodable {
  let action: String
  let note: String?
  let tags: [String]
}

private struct PreferenceEventRequest: Encodable {
  let listingKey: String?
  let eventType: String
  let note: String?
  let transcript: String?
  let tags: [String]
}

private struct InviteAcceptRequest: Encodable {
  let code: String
}

private struct ErrorResponse: Decodable {
  let error: String
}

private struct EmptyBody: Encodable {}
private struct EmptyResponse: Decodable {}
