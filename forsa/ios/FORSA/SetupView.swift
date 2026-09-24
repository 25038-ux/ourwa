import SwiftUI

/// First launch: the organisation's FORSA address, verified before it is saved.
struct SetupView: View {
    @EnvironmentObject private var model: AppModel
    @State private var address = ""
    @State private var checking = false
    @State private var error: LocalizedStringKey?
    @State private var appeared = false
    @State private var shake: CGFloat = 0
    @FocusState private var focused: Bool

    private let deep = Color("BrandDeep")
    private let mint = Color(red: 0.373, green: 0.878, blue: 0.725)

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.07, green: 0.30, blue: 0.24), deep], startPoint: .topLeading, endPoint: .bottom)
                .ignoresSafeArea()
            RadialGradient(colors: [mint.opacity(0.28), .clear], center: .topLeading, startRadius: 10, endRadius: 520)
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Image("LaunchLogo")
                        .resizable()
                        .frame(width: 84, height: 84)
                        .scaleEffect(appeared ? 1 : 0.6)
                        .rotationEffect(.degrees(appeared ? 0 : -12))
                        .opacity(appeared ? 1 : 0)
                        .padding(.top, 72)

                    Text("setup.title")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.top, 28)
                        .modifier(Rise(appeared: appeared, delay: 0.08))

                    Text("setup.subtitle")
                        .font(.system(size: 17))
                        .foregroundColor(Color(red: 0.72, green: 0.85, blue: 0.81))
                        .lineSpacing(3)
                        .padding(.top, 10)
                        .modifier(Rise(appeared: appeared, delay: 0.14))

                    TextField("", text: $address, prompt: Text(verbatim: "https://forsa.example.mr")
                        .foregroundColor(Color(red: 0.44, green: 0.64, blue: 0.58)))
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .focused($focused)
                        .onSubmit(submit)
                        .foregroundColor(.white)
                        .font(.system(size: 17))
                        .padding(.horizontal, 18)
                        .frame(height: 56)
                        .background(RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.08)))
                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(focused ? 0.45 : 0.2), lineWidth: 1))
                        .padding(.top, 32)
                        .modifier(Rise(appeared: appeared, delay: 0.2))
                        .modifier(Shake(amount: shake))

                    if let error {
                        Text(error)
                            .font(.system(size: 15))
                            .foregroundColor(Color(red: 1, green: 0.61, blue: 0.56))
                            .padding(.top, 10)
                            .transition(.opacity)
                    }

                    Button(action: submit) {
                        HStack(spacing: 10) {
                            if checking { ProgressView().tint(Color(red: 0.02, green: 0.07, blue: 0.05)) }
                            Text(checking ? LocalizedStringKey("setup.checking") : LocalizedStringKey("setup.continue"))
                                .font(.system(size: 17, weight: .bold))
                        }
                        .foregroundColor(Color(red: 0.02, green: 0.07, blue: 0.05))
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(RoundedRectangle(cornerRadius: 16).fill(
                            LinearGradient(colors: [mint, Color(red: 0.18, green: 0.77, blue: 0.61)], startPoint: .top, endPoint: .bottom)))
                    }
                    .disabled(checking)
                    .padding(.top, 20)
                    .modifier(Rise(appeared: appeared, delay: 0.26))

                    Text("setup.footer")
                        .font(.system(size: 13))
                        .foregroundColor(Color(red: 0.44, green: 0.64, blue: 0.58))
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .padding(.top, 24)

                    if model.server != nil {
                        Button("setup.cancel") { model.showSetup = false }
                            .foregroundColor(Color(red: 0.72, green: 0.85, blue: 0.81))
                            .frame(maxWidth: .infinity)
                            .padding(.top, 12)
                    }
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 40)
            }
        }
        .onAppear {
            if let server = model.server { address = server.absoluteString }
            withAnimation(.spring(response: 0.6, dampingFraction: 0.72)) { appeared = true }
        }
    }

    private func submit() {
        guard let url = AppModel.normalise(address) else {
            fail("setup.invalid")
            return
        }
        checking = true
        withAnimation { error = nil }
        Task {
            let ok = await AppModel.isForsa(url)
            await MainActor.run {
                checking = false
                if ok {
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    model.save(url)
                } else {
                    fail("setup.unreachable")
                }
            }
        }
    }

    private func fail(_ message: LocalizedStringKey) {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        withAnimation { error = message }
        withAnimation(.linear(duration: 0.4)) { shake += 1 }
    }
}

private struct Rise: ViewModifier {
    let appeared: Bool
    let delay: Double

    func body(content: Content) -> some View {
        content
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 24)
            .animation(.spring(response: 0.55, dampingFraction: 0.85).delay(delay), value: appeared)
    }
}

private struct Shake: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 10 * sin(amount * .pi * 4), y: 0))
    }
}
