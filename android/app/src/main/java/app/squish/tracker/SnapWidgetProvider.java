package app.squish.tracker;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import org.json.JSONObject;

/**
 * The Quick snap widget: one tap opens Squish straight into the camera
 * (squish://snap, the same link as the app shortcut and the web app's; the
 * web app does the rest, src/lib/launch.ts).
 *
 * At its usual size it also shows today at a glance — what is left, the
 * protein, and any snaps to check — from a summary the app leaves for it
 * (src/lib/widgetData.ts, WidgetBridgePlugin), with the words already in the
 * person's language. Made small, or with no summary (a new install, or the
 * numbers turned off in the app), it is just the Quick snap button.
 *
 * It is redrawn when the app sends a new summary, and once just after
 * midnight, when a summary from yesterday means nothing eaten yet today.
 * Never on a timer otherwise.
 */
public class SnapWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "squish_widget";
    static final String SUMMARY = "summary";
    private static final String NEW_DAY = "app.squish.tracker.WIDGET_NEW_DAY";

    /** Shorter than this (dp) and there is room only for the button. */
    private static final int TODAY_MIN_HEIGHT = 90;
    private static final int TODAY_MIN_WIDTH = 200;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int id : widgetIds) {
            manager.updateAppWidget(id, views(context, manager.getAppWidgetOptions(id)));
        }
        scheduleNewDay(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, views(context, options));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (NEW_DAY.equals(intent.getAction())) {
            refresh(context);
            return;
        }
        super.onReceive(context, intent);
    }

    /** Every Squish widget on the home screen, redrawn from the latest summary. */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, SnapWidgetProvider.class));
        for (int id : ids) {
            manager.updateAppWidget(id, views(context, manager.getAppWidgetOptions(id)));
        }
        if (ids.length > 0) {
            scheduleNewDay(context);
        }
    }

    /**
     * A redraw just after midnight. Not a wake-up alarm: if the phone is
     * asleep it waits until somebody wakes it, which is when the widget is
     * next seen anyway.
     */
    private static void scheduleNewDay(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) {
            return;
        }
        Calendar midnight = Calendar.getInstance();
        midnight.add(Calendar.DAY_OF_YEAR, 1);
        midnight.set(Calendar.HOUR_OF_DAY, 0);
        midnight.set(Calendar.MINUTE, 0);
        midnight.set(Calendar.SECOND, 5);
        midnight.set(Calendar.MILLISECOND, 0);
        Intent intent = new Intent(context, SnapWidgetProvider.class).setAction(NEW_DAY);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            1,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        alarms.set(AlarmManager.RTC, midnight.getTimeInMillis(), pending);
    }

    static RemoteViews views(Context context, Bundle options) {
        JSONObject summary = summary(context);
        int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        int width = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        // Sizes are not known before the launcher says (0): the usual size has room.
        boolean roomy = (height == 0 || height >= TODAY_MIN_HEIGHT) && (width == 0 || width >= TODAY_MIN_WIDTH);
        if (summary == null || summary.optBoolean("hidden", false) || !roomy) {
            return snapOnly(context, summary);
        }
        return today(context, summary);
    }

    /** The whole widget is the button. */
    private static RemoteViews snapOnly(Context context, JSONObject summary) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_snap);
        views.setOnClickPendingIntent(R.id.widget_snap_root, snap(context));
        String label = words(summary, "quickSnap");
        if (label != null) {
            views.setTextViewText(R.id.widget_snap_label, label);
        }
        return views;
    }

    private static RemoteViews today(Context context, JSONObject summary) {
        JSONObject energy = summary.optJSONObject("energy");
        JSONObject protein = summary.optJSONObject("protein");
        boolean current = today().equals(summary.optString("date"));
        int target = energy == null ? 0 : energy.optInt("target", 0);
        int eaten = current && energy != null ? energy.optInt("eaten", 0) : 0;
        int proteinTarget = protein == null ? 0 : protein.optInt("target", 0);
        int proteinEaten = current && protein != null ? protein.optInt("eaten", 0) : 0;
        int left = target - eaten;

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        views.setOnClickPendingIntent(R.id.widget_today_root, open(context));
        views.setOnClickPendingIntent(R.id.widget_today_snap, snap(context));

        String leftWords = left >= 0 ? words(summary, "left") : words(summary, "over");
        views.setTextViewText(R.id.widget_today_left, fill(leftWords, "n", Math.abs(left)));
        views.setProgressBar(R.id.widget_today_progress, 100, target > 0 ? Math.min(100, eaten * 100 / target) : 0, false);
        views.setTextViewText(R.id.widget_today_of, fill(fill(words(summary, "ofTarget"), "eaten", eaten), "target", target));
        views.setTextViewText(R.id.widget_today_protein, fill(fill(words(summary, "protein"), "eaten", proteinEaten), "target", proteinTarget));

        // The one line worth a glance: snaps first, as they want doing.
        String note = null;
        if (current && summary.optInt("reading", 0) > 0) {
            note = words(summary, "reading");
        } else if (summary.optInt("toCheck", 0) > 0) {
            note = words(summary, "toCheck");
        } else if (summary.optInt("streak", 0) > 1) {
            note = words(summary, "streak");
        }
        if (note != null) {
            views.setTextViewText(R.id.widget_today_note, note);
            views.setViewVisibility(R.id.widget_today_note, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.widget_today_note, View.GONE);
        }
        String label = words(summary, "quickSnap");
        if (label != null) {
            views.setTextViewText(R.id.widget_today_snap_label, label);
        }
        return views;
    }

    private static JSONObject summary(Context context) {
        String text = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SUMMARY, null);
        if (text == null) {
            return null;
        }
        try {
            JSONObject summary = new JSONObject(text);
            return summary.optInt("v", 0) == 1 ? summary : null;
        } catch (Exception unreadable) {
            return null;
        }
    }

    private static String words(JSONObject summary, String key) {
        JSONObject words = summary == null ? null : summary.optJSONObject("words");
        return words == null ? null : words.optString(key, null);
    }

    private static String fill(String template, String name, int value) {
        if (template == null) {
            return "";
        }
        return template.replace("{" + name + "}", NumberFormat.getIntegerInstance().format(value));
    }

    /** The day as the app writes it: yyyy-MM-dd, on this phone's clock. */
    private static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    private static PendingIntent snap(Context context) {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("squish://snap"), context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent open(Context context) {
        Intent open = new Intent(context, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
