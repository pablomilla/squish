package app.squish.tracker;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/**
 * The Quick snap widget: one tap opens Squish straight into the camera.
 *
 * It opens squish://snap, the same link as the app shortcut and the web
 * app's, and the web app does the rest (src/lib/launch.ts). The widget itself
 * shows nothing that changes, so it never needs updating on a timer.
 */
public class SnapWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        RemoteViews views = views(context);
        for (int id : widgetIds) {
            manager.updateAppWidget(id, views);
        }
    }

    static RemoteViews views(Context context) {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("squish://snap"), context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(
            context,
            0,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_snap);
        views.setOnClickPendingIntent(R.id.widget_snap_root, tap);
        return views;
    }
}
