import UIKit
import UniformTypeIdentifiers

/*
 * "Squish" in the share sheet: a recipe page from Safari, a video from TikTok
 * or Instagram, a few words from Notes.
 *
 * It turns what was shared into squish://share?url=…&text=…, the same link the
 * Android app and the web app use, and the app does the rest (src/lib/shareIn.ts):
 * a link is read as a recipe, words go to Describe.
 *
 * iOS does not let a share extension open its own app in the ordinary way, so
 * the link is also left in the App Group the two share, and the app takes it
 * the moment it is next open (SceneDelegate.swift, ShareInbox). Opening Squish
 * straight away is tried as well; where iOS will not have it, the sheet says
 * to open Squish, and the recipe is waiting there.
 *
 * Added to the Xcode project as a Share Extension target: see docs/share-in.md.
 */

let appGroup = "group.app.squish.tracker"
let pendingKey = "pendingShare"

final class ShareViewController: UIViewController {
    private let message = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        message.text = "Sending to Squish…"
        message.font = .preferredFont(forTextStyle: .headline)
        message.textAlignment = .center
        message.numberOfLines = 0
        message.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(message)
        NSLayoutConstraint.activate([
            message.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            message.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            message.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            message.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task { await handOver() }
    }

    private func handOver() async {
        guard let link = await sharedLink() else {
            finish(saying: "There was nothing Squish could read in that.")
            return
        }
        // Kept first, so it is there whatever happens next.
        UserDefaults(suiteName: appGroup)?.set(link.absoluteString, forKey: pendingKey)
        // Whether iOS lets it open is not something it says, so this never
        // assumes it did: if Squish opens, this sheet goes with it.
        openSquish(link)
        finish(saying: "Sent to Squish. Open Squish and it will be there.")
    }

    /** What was shared, as squish://share?url=…&text=… — the page's link if there is one, and any words with it. */
    private func sharedLink() async -> URL? {
        var url: URL?
        var text: String?
        for item in (extensionContext?.inputItems as? [NSExtensionItem]) ?? [] {
            for provider in item.attachments ?? [] {
                if url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let found = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
                   found.scheme == "http" || found.scheme == "https" {
                    url = found
                }
                if text == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                   let found = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    text = found
                }
            }
            if text == nil, let words = item.attributedContentText?.string, !words.isEmpty {
                text = words
            }
        }
        guard url != nil || text != nil else { return nil }
        var parts = URLComponents()
        parts.scheme = "squish"
        parts.host = "share"
        parts.queryItems = [
            url.map { URLQueryItem(name: "url", value: $0.absoluteString) },
            text.map { URLQueryItem(name: "text", value: String($0.prefix(2000))) },
        ].compactMap { $0 }
        return parts.url
    }

    /**
     * Squish, opened with the link. A share extension has no UIApplication of
     * its own to ask, so the responder chain is walked to the one that is
     * there. Best effort: where iOS says no, the link waits in the App Group.
     */
    private func openSquish(_ link: URL) {
        let selector = sel_registerName("openURL:")
        var responder: UIResponder? = self
        while let current = responder {
            if current is UIApplication, current.responds(to: selector) {
                _ = current.perform(selector, with: link)
                return
            }
            responder = current.next
        }
    }

    private func finish(saying words: String) {
        message.text = words
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [weak self] in self?.done() }
    }

    private func done() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
