package app.squish.tracker;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setIntent(asShareLink(getIntent()));
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(asShareLink(intent));
    }

    /**
     * Something shared into Squish from another app's share sheet arrives as
     * SEND, with the link or words as its text. The app itself reads links
     * (src/lib/shareIn.ts), so it is handed on as squish://share?text=…,
     * the same link the iPhone's share extension opens.
     */
    static Intent asShareLink(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return intent;
        }
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (text == null && subject == null) {
            return intent;
        }
        Uri.Builder link = new Uri.Builder().scheme("squish").authority("share");
        if (text != null) {
            link.appendQueryParameter("text", text);
        }
        if (subject != null) {
            link.appendQueryParameter("title", subject);
        }
        Intent view = new Intent(Intent.ACTION_VIEW, link.build());
        view.setPackage(intent.getPackage());
        return view;
    }
}
