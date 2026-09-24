import Foundation
import UIKit

/// Which FORSA server this phone talks to. Chosen on first launch (or baked in with FORSA_DEFAULT_SERVER).
final class AppModel: ObservableObject {
    static let shared = AppModel()
    static let changeServerShortcut = "mr.forsa.app.change-server"

    @Published var server: URL?
    @Published var showSetup = false

    private let storageKey = "forsa.server"

    init() {
        if let saved = UserDefaults.standard.string(forKey: storageKey), let url = URL(string: saved) {
            server = url
        } else if let baked = Bundle.main.object(forInfoDictionaryKey: "FORSADefaultServer") as? String,
                  let url = AppModel.normalise(baked) {
            server = url
        }
    }

    func save(_ url: URL) {
        UserDefaults.standard.set(url.absoluteString, forKey: storageKey)
        server = url
        showSetup = false
    }

    func handle(shortcut: UIApplicationShortcutItem) {
        guard shortcut.type == AppModel.changeServerShortcut else { return }
        DispatchQueue.main.async { self.showSetup = true }
    }

    /// "forsa.example.mr" → https://forsa.example.mr ; plain http is accepted only in debug builds.
    static func normalise(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        guard !text.isEmpty else { return nil }
        if !text.lowercased().hasPrefix("http://") && !text.lowercased().hasPrefix("https://") {
            text = "https://" + text
        }
        guard let components = URLComponents(string: text), let host = components.host, !host.isEmpty else {
            return nil
        }
        #if !DEBUG
        if components.scheme?.lowercased() != "https" { return nil }
        #endif
        var clean = URLComponents()
        clean.scheme = components.scheme?.lowercased()
        clean.host = host.lowercased()
        clean.port = components.port
        return clean.url
    }

    /// A FORSA server publishes a web-app manifest that names FORSA.
    static func isForsa(_ server: URL) async -> Bool {
        let url = server.appendingPathComponent("manifest.webmanifest")
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.setValue("application/manifest+json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return false }
            return String(decoding: data.prefix(8000), as: UTF8.self).contains("FORSA")
        } catch {
            return false
        }
    }
}
