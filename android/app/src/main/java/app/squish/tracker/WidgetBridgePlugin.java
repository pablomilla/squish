package app.squish.tracker;

import android.content.Context;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Today, for the Quick snap widget: the summary the app works out
 * (src/lib/widgetData.ts), kept where SnapWidgetProvider reads it, and the
 * widget redrawn. The app sends it only when it has changed.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        String summary = call.getString("summary");
        if (summary == null) {
            call.reject("No summary");
            return;
        }
        Context context = getContext();
        context.getSharedPreferences(SnapWidgetProvider.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(SnapWidgetProvider.SUMMARY, summary)
            .apply();
        SnapWidgetProvider.refresh(context);
        call.resolve();
    }
}
