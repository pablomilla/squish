import AppIntents
import SwiftUI
import UIKit
import WidgetKit

/*
 * Quick snap, on the iPhone: a widget for the Home Screen and the Lock Screen,
 * and (iOS 18) a control for Control Centre and the Action Button.
 *
 * Tapping opens squish://snap. The app takes it from there (src/lib/launch.ts):
 * straight into the camera, one tap, and the photo is read in the background
 * and logged for checking later.
 *
 * Beside the button the widget shows today at a glance — what is left, the
 * protein, the streak and any snaps to check — from a summary the app leaves
 * in the App Group it shares with this extension (src/lib/widgetData.ts,
 * SceneDelegate.swift's WidgetBridge). The words come with it, already in
 * the person's language. Without a summary (a new install, or somebody who
 * turned the numbers off in the app) it is just the Quick snap button.
 *
 * Added to the Xcode project as a Widget Extension target: see docs/widgets.md.
 */

private let snapURL = URL(string: "squish://snap")!
/// Opens the app where it was: a link nothing in the app handles.
private let openURL = URL(string: "squish://home")!

private let appGroup = "group.app.squish.tracker"
private let summaryKey = "widgetSummary"

// MARK: - The app's colours (src/styles/tokens.css), light and dark

private func rgb(_ hex: UInt32) -> UIColor {
    UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

private func themed(_ light: UInt32, _ dark: UInt32) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? rgb(dark) : rgb(light) })
}

/// --bg: the cream (or deep plum) the whole app sits on.
private let squishBackground = themed(0xFDF6EC, 0x17151F)
/// --ink and --ink-2.
private let squishInk = themed(0x2B2340, 0xF4F0FF)
private let squishInk2 = themed(0x6B6480, 0xB7AFD0)
/// --brand, and --brand-soft for the track a ring or bar fills.
private let squishBrand = themed(0x6B5FE0, 0x8B80F5)
private let squishBrandSoft = themed(0xE6E2FB, 0x2E2A48)

// MARK: - Today, as the app left it

/// The shape src/lib/widgetData.ts writes. Version 1.
struct DaySummary: Decodable {
    struct Energy: Decodable {
        let eaten: Int
        let target: Int
        let unit: String
    }

    struct Protein: Decodable {
        let eaten: Int
        let target: Int
    }

    struct Words: Decodable {
        let quickSnap: String
        let left: String
        let over: String
        let ofTarget: String
        let protein: String
        let streak: String
        let toCheck: String
        let reading: String
        let openApp: String
        let tagline: String
    }

    let v: Int
    let date: String
    let hidden: Bool
    let energy: Energy
    let protein: Protein
    let streak: Int
    let toCheck: Int
    let reading: Int
    let words: Words

    static func load() -> DaySummary? {
        guard let text = UserDefaults(suiteName: appGroup)?.string(forKey: summaryKey),
              let data = text.data(using: .utf8),
              let summary = try? JSONDecoder().decode(DaySummary.self, from: data),
              summary.v == 1
        else { return nil }
        return summary
    }

    /// For the widget gallery, before the app has said anything.
    static let sample = DaySummary(
        v: 1,
        date: isoDay(.now),
        hidden: false,
        energy: Energy(eaten: 1_180, target: 1_850, unit: "kcal"),
        protein: Protein(eaten: 74, target: 110),
        streak: 12,
        toCheck: 1,
        reading: 0,
        words: Words(
            quickSnap: "Quick snap",
            left: "{n} kcal left",
            over: "{n} kcal over",
            ofTarget: "{eaten} of {target} kcal",
            protein: "{eaten} of {target} g protein",
            streak: "12-day streak",
            toCheck: "1 snap to check",
            reading: "Reading 1 snap…",
            openApp: "Open Squish",
            tagline: "Photograph a meal in one tap. Squish logs it for you to check later."
        )
    )
}

/// The day as the app writes it: yyyy-MM-dd, on this phone's clock.
private func isoDay(_ date: Date) -> String {
    let format = DateFormatter()
    format.calendar = Calendar(identifier: .gregorian)
    format.locale = Locale(identifier: "en_US_POSIX")
    format.timeZone = .current
    format.dateFormat = "yyyy-MM-dd"
    return format.string(from: date)
}

private func number(_ n: Int) -> String {
    NumberFormatter.localizedString(from: NSNumber(value: n), number: .decimal)
}

private func fill(_ template: String, _ values: [String: Int]) -> String {
    values.reduce(template) { text, pair in text.replacingOccurrences(of: "{\(pair.key)}", with: number(pair.value)) }
}

/// Today's figures from the summary. A summary from an earlier day means nothing eaten yet today.
struct Today {
    let summary: DaySummary
    let eaten: Int
    let proteinEaten: Int
    let reading: Int

    init(_ summary: DaySummary, on date: Date) {
        let current = summary.date == isoDay(date)
        self.summary = summary
        eaten = current ? summary.energy.eaten : 0
        proteinEaten = current ? summary.protein.eaten : 0
        reading = current ? summary.reading : 0
    }

    var words: DaySummary.Words { summary.words }
    var left: Int { summary.energy.target - eaten }
    var fraction: Double {
        summary.energy.target > 0 ? min(1, Double(eaten) / Double(summary.energy.target)) : 0
    }
    var leftLine: String { left >= 0 ? fill(words.left, ["n": left]) : fill(words.over, ["n": -left]) }
    var ofTargetLine: String { fill(words.ofTarget, ["eaten": eaten, "target": summary.energy.target]) }
    var proteinLine: String { fill(words.protein, ["eaten": proteinEaten, "target": summary.protein.target]) }
    /// The one line worth a glance under the numbers: snaps first, as they want doing.
    var note: String? {
        if reading > 0 { return words.reading }
        if summary.toCheck > 0 { return words.toCheck }
        if summary.streak > 1 { return words.streak }
        return nil
    }
}

// MARK: - The widget

struct SnapEntry: TimelineEntry {
    let date: Date
    let summary: DaySummary?

    var today: Today? {
        guard let summary, !summary.hidden else { return nil }
        return Today(summary, on: date)
    }
}

/**
 * The app asks for a redraw whenever today changes. The one change it cannot
 * be there for is midnight, so the timeline has a second entry then, which
 * starts the new day at nothing eaten.
 */
struct SnapProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapEntry { SnapEntry(date: .now, summary: .sample) }

    func getSnapshot(in context: Context, completion: @escaping (SnapEntry) -> Void) {
        completion(SnapEntry(date: .now, summary: DaySummary.load() ?? (context.isPreview ? .sample : nil)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapEntry>) -> Void) {
        let now = Date.now
        let summary = DaySummary.load()
        let midnight = Calendar.current.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) ?? now.addingTimeInterval(86_400)
        completion(Timeline(entries: [SnapEntry(date: now, summary: summary), SnapEntry(date: midnight, summary: summary)], policy: .never))
    }
}

/// The app's camera (CameraIcon in src/components/icons.tsx): an outline on a 24-point grid, drawn at any size.
struct SquishCamera: Shape {
    func path(in rect: CGRect) -> Path {
        let k = min(rect.width, rect.height) / 24
        let x = rect.midX - 12 * k
        let y = rect.midY - 12 * k
        func p(_ px: CGFloat, _ py: CGFloat) -> CGPoint { CGPoint(x: x + px * k, y: y + py * k) }
        var path = Path()
        // The body, with corners of 1.5 and the bump on top: M3 8.5 … z
        path.move(to: p(3, 8.5))
        path.addArc(tangent1End: p(3, 7), tangent2End: p(4.5, 7), radius: 1.5 * k)
        path.addLine(to: p(6.7, 7))
        path.addLine(to: p(8, 5))
        path.addLine(to: p(15.9, 5))
        path.addLine(to: p(17.3, 7))
        path.addLine(to: p(19.5, 7))
        path.addArc(tangent1End: p(21, 7), tangent2End: p(21, 8.5), radius: 1.5 * k)
        path.addLine(to: p(21, 17.5))
        path.addArc(tangent1End: p(21, 19), tangent2End: p(19.5, 19), radius: 1.5 * k)
        path.addLine(to: p(4.5, 19))
        path.addArc(tangent1End: p(3, 19), tangent2End: p(3, 17.5), radius: 1.5 * k)
        path.closeSubpath()
        // The lens.
        path.addEllipse(in: CGRect(origin: p(12 - 3.4, 13 - 3.4), size: CGSize(width: 6.8 * k, height: 6.8 * k)))
        return path
    }
}

/// The camera as the app draws it: stroked, round-ended, 1.9 points in 24.
struct CameraIcon: View {
    var size: CGFloat = 22

    var body: some View {
        SquishCamera()
            .stroke(style: StrokeStyle(lineWidth: 1.9 * size / 24, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The Squish wordmark (Assets.xcassets, drawn from site/img/wordmark.svg, with a dark version).
struct Wordmark: View {
    var height: CGFloat = 18

    var body: some View {
        Image("Wordmark")
            .resizable()
            .scaledToFit()
            .frame(height: height)
            .accessibilityLabel(Text("Squish"))
    }
}

/// The Quick snap button as the app draws its main buttons: white on Squish's purple.
struct SnapButtonFace: View {
    let label: String
    var iconSize: CGFloat = 28

    var body: some View {
        VStack(spacing: 6) {
            CameraIcon(size: iconSize)
            Text(label)
                .font(.caption.weight(.bold))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .foregroundStyle(.white)
        .padding(8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(squishBrand, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

/// How far through today's energy: a ring in the app's purple, with the camera in the middle, since a tap snaps.
struct DayRing: View {
    let fraction: Double
    var lineWidth: CGFloat = 6
    var iconSize: CGFloat = 22

    var body: some View {
        ZStack {
            Circle().stroke(squishBrandSoft, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(squishBrand, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            CameraIcon(size: iconSize).foregroundStyle(squishBrand)
        }
    }
}

struct SnapWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapEntry

    var body: some View {
        content
            .widgetURL(family == .systemMedium ? openURL : snapURL)
            .containerBackground(for: .widget) { background }
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryCircular:
            if let today = entry.today {
                Gauge(value: today.fraction) {
                    CameraIcon(size: 14)
                } currentValueLabel: {
                    CameraIcon(size: 20)
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .accessibilityLabel(Text(today.words.quickSnap))
            } else {
                CameraIcon(size: 26)
                    .accessibilityLabel(Text("Quick snap"))
            }
        case .accessoryRectangular:
            HStack(spacing: 8) {
                CameraIcon(size: 24)
                VStack(alignment: .leading, spacing: 0) {
                    Text(entry.today?.words.quickSnap ?? "Quick snap").font(.headline)
                    if let today = entry.today {
                        Text(today.leftLine).font(.caption).privacySensitive()
                    } else {
                        Text("Squish").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .systemMedium:
            if let today = entry.today {
                medium(today)
            } else {
                mediumSnapOnly
            }
        default:
            if let today = entry.today {
                small(today)
            } else {
                snapOnly
            }
        }
    }

    private var quickSnapWords: String { entry.summary?.words.quickSnap ?? "Quick snap" }

    /// No numbers: the wordmark, and the whole widget is the button.
    private var snapOnly: some View {
        VStack(alignment: .leading, spacing: 10) {
            Wordmark()
            SnapButtonFace(label: quickSnapWords, iconSize: 34)
        }
    }

    private var mediumSnapOnly: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Wordmark(height: 22)
                Spacer(minLength: 0)
                Text(entry.summary?.words.tagline ?? "Photograph a meal in one tap. Squish logs it for you to check later.")
                    .font(.caption)
                    .foregroundStyle(squishInk2)
                    .lineLimit(3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Link(destination: snapURL) { SnapButtonFace(label: quickSnapWords) }
                .frame(width: 108)
        }
    }

    /// Small: the wordmark, the ring and what is left. Small widgets have one tap, so all of it snaps.
    private func small(_ today: Today) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Wordmark()
            Spacer(minLength: 0)
            DayRing(fraction: today.fraction)
                .frame(width: 54, height: 54)
            Spacer(minLength: 0)
            Text(today.leftLine)
                .font(.headline)
                .foregroundStyle(squishInk)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .privacySensitive()
            Text(today.words.quickSnap)
                .font(.caption.weight(.bold))
                .foregroundStyle(squishBrand)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    /// Medium: the wordmark and today on the left, opening the app; the Quick snap button on the right.
    private func medium(_ today: Today) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Wordmark()
                Spacer(minLength: 0)
                Group {
                    Text(today.leftLine)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(squishInk)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    ProgressView(value: today.fraction)
                        .tint(squishBrand)
                    Text(today.ofTargetLine).font(.caption).foregroundStyle(squishInk2)
                    Text(today.proteinLine).font(.caption).foregroundStyle(squishInk2)
                    if let note = today.note {
                        Text(note).font(.caption.weight(.semibold)).foregroundStyle(squishBrand).lineLimit(1)
                    }
                }
                .privacySensitive()
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Link(destination: snapURL) { SnapButtonFace(label: today.words.quickSnap) }
                .frame(width: 108)
        }
    }

    @ViewBuilder private var background: some View {
        switch family {
        case .accessoryCircular:
            AccessoryWidgetBackground()
        case .accessoryRectangular:
            Color.clear
        default:
            squishBackground
        }
    }
}

struct SnapWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SquishQuickSnap", provider: SnapProvider()) { entry in
            SnapWidgetView(entry: entry)
        }
        .configurationDisplayName("Quick snap")
        .description("Photograph a meal in one tap and put your phone away. Squish logs it for you to check later, and shows what is left today.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}

// MARK: - The control (iOS 18): Control Centre, the Lock Screen's buttons, the Action Button

@available(iOS 18.0, *)
struct SnapControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "app.squish.tracker.QuickSnapControl") {
            ControlWidgetButton(action: OpenSnapIntent()) {
                // Controls take only SF Symbols: the outline camera is the nearest to the app's.
                Label("Quick snap", systemImage: "camera")
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
