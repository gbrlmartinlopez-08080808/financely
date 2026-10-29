package app.quire.reader;

import android.content.Context;
import android.util.AttributeSet;
import android.view.ActionMode;

import com.getcapacitor.CapacitorWebView;

/**
 * Capacitor's WebView, with one extra: the system "Copy / Select all / Google" popup can be switched off
 * while reading so it never covers (or competes with) Quire's own word menu. Selection handles still work.
 */
public class QuireWebView extends CapacitorWebView {
    private volatile boolean suppressSelectionMenu = true;

    public QuireWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public void setSuppressSelectionMenu(boolean suppress) {
        suppressSelectionMenu = suppress;
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        if (suppressSelectionMenu) return null;
        return super.startActionMode(callback);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        if (suppressSelectionMenu) return null;
        return super.startActionMode(callback, type);
    }
}
