import Combine
import QuickLook
import SwiftUI
import UIKit
import WebKit

/// The FORSA web app full screen, with native splash, progress, offline and download handling.
struct WebShell: View {
    let server: URL
    @EnvironmentObject private var model: AppModel
    @StateObject private var state = WebState()

    var body: some View {
        ZStack(alignment: .top) {
            Color("BrandSand").ignoresSafeArea()

            WebView(server: server, state: state)
                .ignoresSafeArea()
                .opacity(state.hasLoaded ? 1 : 0)

            if !state.hasLoaded && !state.offline {
                Splash()
                    .transition(.opacity)
            }

            ProgressBar(progress: state.progress)
                .opacity(state.loading && state.hasLoaded ? 1 : 0)
                .animation(.easeOut(duration: 0.2), value: state.loading)

            if state.offline {
                OfflineView(detail: state.errorText, retry: { state.retry() }, changeServer: { model.showSetup = true })
                    .transition(.opacity.combined(with: .scale(scale: 0.97)))
            }
        }
        .animation(.easeOut(duration: 0.3), value: state.offline)
        .animation(.easeOut(duration: 0.4), value: state.hasLoaded)
    }
}

/// What the native chrome needs to know about the page.
@MainActor
final class WebState: ObservableObject {
    @Published var progress: Double = 0
    @Published var loading = false
    @Published var hasLoaded = false
    @Published var offline = false
    @Published var errorText: String?
    weak var webView: WKWebView?
    var start: URL?

    func retry() {
        offline = false
        errorText = nil
        guard let webView else { return }
        if webView.url == nil, let start {
            webView.load(URLRequest(url: start))
        } else {
            webView.reload()
        }
    }
}

struct WebView: UIViewRepresentable {
    let server: URL
    let state: WebState

    func makeCoordinator() -> Coordinator {
        Coordinator(server: server, state: state)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.applicationNameForUserAgent = "Mobile/15E148 FORSA-iOS/1.0"
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile

        let controller = configuration.userContentController
        controller.add(WeakScriptHandler(context.coordinator), name: "forsa")
        controller.addUserScript(WKUserScript(
            source: "window.FORSA_SHELL='ios';document.documentElement.setAttribute('data-shell','ios');",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "BrandSand")
        webView.underPageBackgroundColor = UIColor(named: "BrandSand")
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        let refresh = UIRefreshControl()
        refresh.tintColor = UIColor(named: "AccentColor")
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.pullToRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        context.coordinator.attach(webView)
        webView.load(URLRequest(url: server))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "forsa")
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
        private let server: URL
        private let state: WebState
        private weak var webView: WKWebView?
        private var observers = Set<AnyCancellable>()
        private var destinations: [ObjectIdentifier: URL] = [:]
        private var preview: PreviewSource?

        init(server: URL, state: WebState) {
            self.server = server
            self.state = state
        }

        func attach(_ webView: WKWebView) {
            self.webView = webView
            state.webView = webView
            state.start = server
            webView.publisher(for: \.estimatedProgress)
                .receive(on: DispatchQueue.main)
                .sink { [weak self] value in self?.state.progress = value }
                .store(in: &observers)
            webView.publisher(for: \.isLoading)
                .receive(on: DispatchQueue.main)
                .sink { [weak self] value in self?.state.loading = value }
                .store(in: &observers)
        }

        @objc func pullToRefresh(_ sender: UIRefreshControl) {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            if webView?.url == nil { state.retry() } else { webView?.reload() }
        }

        // MARK: Navigation

        private func isOwn(_ url: URL) -> Bool {
            guard let scheme = url.scheme?.lowercased() else { return false }
            if ["about", "blob", "data"].contains(scheme) { return true }
            return scheme == server.scheme && url.host?.lowercased() == server.host && url.port == server.port
        }

        private func openExternally(_ url: URL) {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
            if isOwn(url) {
                return decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
            }
            // Embedded frames may load what they need; leaving the app (WhatsApp, official notice, e-mail) opens the
            // right app instead of replacing FORSA.
            if let frame = navigationAction.targetFrame, !frame.isMainFrame {
                return decisionHandler(.allow)
            }
            openExternally(url)
            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            let disposition = (navigationResponse.response as? HTTPURLResponse)?
                .value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
            let calendar = navigationResponse.response.mimeType == "text/calendar"
            if disposition.hasPrefix("attachment") || calendar || !navigationResponse.canShowMIMEType {
                return decisionHandler(.download)
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            state.offline = false
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            NSLog("FORSA web: loaded %@ frame=%@ safeArea=%@ window=%@", webView.url?.absoluteString ?? "-",
                  NSCoder.string(for: webView.frame), NSCoder.string(for: webView.safeAreaInsets),
                  NSCoder.string(for: webView.window?.safeAreaInsets ?? .zero))
            webView.scrollView.refreshControl?.endRefreshing()
            state.hasLoaded = true
        }

        /// The page could not be fetched at all: always tell the user why (never leave them on the splash).
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            failed(webView, error, beforeDisplay: true)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failed(webView, error, beforeDisplay: false)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        private func failed(_ webView: WKWebView, _ error: Error, beforeDisplay: Bool) {
            webView.scrollView.refreshControl?.endRefreshing()
            let nsError = error as NSError
            NSLog("FORSA web: load failed %@ %ld %@", nsError.domain, nsError.code, nsError.localizedDescription)
            // Cancelled loads and loads turned into downloads are not failures.
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
            if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return }
            let networkCodes = [
                NSURLErrorNotConnectedToInternet, NSURLErrorTimedOut, NSURLErrorCannotFindHost,
                NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost, NSURLErrorDNSLookupFailed,
            ]
            // A page already on screen stays usable after a late failure unless the network itself is gone.
            guard beforeDisplay || (nsError.domain == NSURLErrorDomain && networkCodes.contains(nsError.code)) else { return }
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            state.errorText = nsError.localizedDescription
            state.offline = true
        }

        // MARK: Windows, dialogs, microphone

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url {
                if isOwn(url) { webView.load(navigationAction.request) } else { openExternally(url) }
            }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: NSLocalizedString("ok", comment: ""), style: .default) { _ in
                completionHandler()
            })
            if !present(alert, from: webView) { completionHandler() }
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: NSLocalizedString("cancel", comment: ""), style: .cancel) { _ in
                completionHandler(false)
            })
            alert.addAction(UIAlertAction(title: NSLocalizedString("ok", comment: ""), style: .default) { _ in
                completionHandler(true)
            })
            if !present(alert, from: webView) { completionHandler(false) }
        }

        /// Voice dictation asks for the microphone; only the FORSA server itself may use it.
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            let sameServer = origin.host.lowercased() == server.host && origin.protocol == server.scheme
            decisionHandler(sameServer && type == .microphone ? .grant : .deny)
        }

        // MARK: Bridge (haptics)

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], body["type"] as? String == "haptic" else { return }
            switch body["style"] as? String {
            case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
            case "selection": UISelectionFeedbackGenerator().selectionChanged()
            case "heavy": UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
        }

        // MARK: Downloads (.ics calendar, exports) → Quick Look, which offers "Add to Calendar" and Share

        func download(
            _ download: WKDownload,
            decideDestinationUsing response: URLResponse,
            suggestedFilename: String,
            completionHandler: @escaping (URL?) -> Void
        ) {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let name = suggestedFilename.isEmpty ? "forsa-download" : suggestedFilename
            let destination = folder.appendingPathComponent(name)
            destinations[ObjectIdentifier(download)] = destination
            completionHandler(destination)
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let file = destinations.removeValue(forKey: ObjectIdentifier(download)), let webView else { return }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            let source = PreviewSource(file: file)
            preview = source
            let controller = QLPreviewController()
            controller.dataSource = source
            present(controller, from: webView)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            destinations.removeValue(forKey: ObjectIdentifier(download))
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }

        @discardableResult
        private func present(_ controller: UIViewController, from webView: WKWebView) -> Bool {
            guard var top = webView.window?.rootViewController else { return false }
            while let next = top.presentedViewController { top = next }
            controller.popoverPresentationController?.sourceView = webView
            top.present(controller, animated: true)
            return true
        }
    }
}

/// WKUserContentController keeps its handlers alive; this proxy breaks the cycle with the coordinator.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

/// Quick Look keeps a weak reference to its data source.
private final class PreviewSource: NSObject, QLPreviewControllerDataSource {
    let file: URL

    init(file: URL) {
        self.file = file
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        file as NSURL
    }
}

// MARK: - Native chrome

private struct Splash: View {
    @State private var pulse = false

    var body: some View {
        ZStack {
            Color("LaunchBackground").ignoresSafeArea()
            Image("LaunchLogo")
                .resizable()
                .frame(width: 96, height: 96)
                .scaleEffect(pulse ? 1.06 : 0.96)
                .opacity(pulse ? 1 : 0.8)
                .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: pulse)
        }
        .onAppear { pulse = true }
    }
}

private struct ProgressBar: View {
    let progress: Double

    var body: some View {
        GeometryReader { proxy in
            Capsule()
                .fill(LinearGradient(colors: [Color(red: 0.373, green: 0.878, blue: 0.725), Color("AccentColor")],
                                     startPoint: .leading, endPoint: .trailing))
                .frame(width: max(12, proxy.size.width * progress), height: 3)
                .animation(.easeOut(duration: 0.25), value: progress)
        }
        .frame(height: 3)
    }
}

private struct OfflineView: View {
    let detail: String?
    let retry: () -> Void
    let changeServer: () -> Void
    @State private var appeared = false

    var body: some View {
        ZStack {
            Color("BrandSand").ignoresSafeArea()
            VStack(spacing: 14) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 44, weight: .semibold))
                    .foregroundColor(Color("BrandDeep"))
                    .scaleEffect(appeared ? 1 : 0.7)
                    .opacity(appeared ? 1 : 0)
                Text("offline.title")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundColor(Color("BrandDeep"))
                Text("offline.body")
                    .font(.system(size: 16))
                    .foregroundColor(Color(red: 0.36, green: 0.40, blue: 0.38))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 36)
                if let detail {
                    Text(verbatim: detail)
                        .font(.system(size: 13))
                        .foregroundColor(Color(red: 0.55, green: 0.58, blue: 0.56))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 36)
                }
                Button(action: {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    retry()
                }) {
                    Text("offline.retry")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 220, height: 52)
                        .background(Capsule().fill(Color("BrandDeep")))
                }
                .padding(.top, 10)
                Button(action: changeServer) {
                    Text("offline.change_server")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Color("AccentColor"))
                }
            }
            .offset(y: appeared ? 0 : 16)
        }
        .onAppear { withAnimation(.spring(response: 0.5, dampingFraction: 0.75)) { appeared = true } }
    }
}
