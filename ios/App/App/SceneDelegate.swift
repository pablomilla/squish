import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = SquishViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// The app's web view, with Squish's own plugins added to Capacitor's.
class SquishViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ShareInboxPlugin())
    }
}

/**
 * What the share extension left for the app (ios/App/SquishShare): a
 * squish://share link waiting in the App Group the two share, taken once.
 * Here rather than in a file of its own so the App target needs no new files.
 */
@objc(ShareInboxPlugin)
public class ShareInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareInboxPlugin"
    public let jsName = "ShareInbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise),
    ]

    @objc func take(_ call: CAPPluginCall) {
        let shared = UserDefaults(suiteName: "group.app.squish.tracker")
        let link = shared?.string(forKey: "pendingShare")
        shared?.removeObject(forKey: "pendingShare")
        if let link = link {
            call.resolve(["link": link])
        } else {
            call.resolve([:])
        }
    }
}
