import AppIntents
import SwiftUI
import WidgetKit

/*
 * Quick snap, on the iPhone: a widget for the Home Screen and the Lock Screen,
 * and (iOS 18) a control for Control Centre and the Action Button.
 *
 * None of them does anything but open squish://snap. The app takes it from
 * there (src/lib/launch.ts): straight into the camera, one tap, and the photo
 * is read in the background and logged for checking later. So there is no
 * data to share with the app and nothing on the widget ever changes.
 *
 * Added to the Xcode project as a Widget Extension target: see docs/widgets.md.
 * Its words are English only for now; translating them is on the to-do list
 * there, for once the widget is running on a phone.
 */

private let snapURL = URL(string: "squish://snap")!

/// Squish's purple, as the app draws it (#6B5FE0).
private let squishPurple = Color(red: 107 / 255, green: 95 / 255, blue: 224 / 255)

// MARK: - The widget

struct SnapEntry: TimelineEntry {
    let date: Date
}

/// Nothing on the widget changes, so there is one entry and it never needs another.
struct SnapProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapEntry { SnapEntry(date: .now) }

    func getSnapshot(in context: Context, completion: @escaping (SnapEntry) -> Void) {
        completion(SnapEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapEntry>) -> Void) {
        completion(Timeline(entries: [SnapEntry(date: .now)], policy: .never))
    }
}

struct SnapWidgetView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(snapURL)
            .containerBackground(for: .widget) { background }
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryCircular:
            Image(systemName: "camera.fill")
                .font(.title2.weight(.semibold))
                .accessibilityLabel(Text("Quick snap"))
        case .accessoryRectangular:
            HStack(spacing: 8) {
                Image(systemName: "camera.fill").font(.title3.weight(.semibold))
                VStack(alignment: .leading, spacing: 0) {
                    Text("Quick snap").font(.headline)
                    Text("Squish").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(spacing: 10) {
                Image(systemName: "camera.fill")
                    .font(.system(size: 36, weight: .semibold))
                Text("Quick snap")
                    .font(.headline)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder private var background: some View {
        switch family {
        case .accessoryCircular:
            AccessoryWidgetBackground()
        case .accessoryRectangular:
            Color.clear
        default:
            squishPurple
        }
    }
}

struct SnapWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SquishQuickSnap", provider: SnapProvider()) { _ in
            SnapWidgetView()
        }
        .configurationDisplayName("Quick snap")
        .description("Photograph a meal in one tap and put your phone away. Squish logs it for you to check later.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

// MARK: - The control (iOS 18): Control Centre, the Lock Screen's buttons, the Action Button

@available(iOS 18.0, *)
struct SnapControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "app.squish.tracker.QuickSnapControl") {
            ControlWidgetButton(action: OpenSnapIntent()) {
                Label("Quick snap", systemImage: "camera.fill")
            }
        }
        .displayName("Quick snap")
        .description("Open Squish's camera to snap a meal.")
    }
}

/// Opens the app at squish://snap, the same as tapping the widget.
@available(iOS 18.0, *)
struct OpenSnapIntent: AppIntent {
    static let title: LocalizedStringResource = "Quick snap"
    static let description = IntentDescription("Open Squish's camera to snap a meal.")

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(snapURL))
    }
}

// MARK: - Everything the extension offers

@main
struct SquishWidgets: WidgetBundle {
    var body: some Widget {
        SnapWidget()
        if #available(iOS 18.0, *) {
            SnapControl()
        }
    }
}
