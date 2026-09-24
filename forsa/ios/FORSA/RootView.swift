import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack {
            if let server = model.server, !model.showSetup {
                WebShell(server: server)
                    .id(server)
                    .transition(.opacity)
            } else {
                SetupView()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.5, dampingFraction: 0.86), value: model.showSetup)
        .animation(.spring(response: 0.5, dampingFraction: 0.86), value: model.server)
    }
}
