package app.frogity.reader;

import android.content.Context;
import android.util.AttributeSet;
import android.graphics.Rect;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;

import com.getcapacitor.CapacitorWebView;

/**
 * Capacitor's WebView, with one extra: the system "Copy / Select all / Google" popup can be switched off
 * while reading so it never covers (or competes with) Frogity’s own word menu. Selection handles still work.
 */
public class FrogityWebView extends CapacitorWebView {
    private volatile boolean suppressSelectionMenu = true;

    public FrogityWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public void setSuppressSelectionMenu(boolean suppress) {
        suppressSelectionMenu = suppress;
    }

    /**
     * Returning null from startActionMode() makes Chromium throw the selection away, so the word would
     * flash and vanish. Instead the system bar is started but with an empty menu: the selection and its
     * handles stay, and nothing competes with Frogity’s own menu.
     */
    private ActionMode.Callback quiet(final ActionMode.Callback cb) {
        if (!suppressSelectionMenu || cb == null) return cb;
        if (cb instanceof ActionMode.Callback2) {
            final ActionMode.Callback2 c2 = (ActionMode.Callback2) cb;
            return new ActionMode.Callback2() {
                @Override
                public boolean onCreateActionMode(ActionMode mode, Menu menu) {
                    c2.onCreateActionMode(mode, menu);
                    menu.clear();
                    return true;
                }

                @Override
                public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
                    c2.onPrepareActionMode(mode, menu);
                    menu.clear();
                    return true;
                }

                @Override
                public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
                    return c2.onActionItemClicked(mode, item);
                }

                @Override
                public void onDestroyActionMode(ActionMode mode) {
                    c2.onDestroyActionMode(mode);
                }

                @Override
                public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
                    c2.onGetContentRect(mode, view, outRect);
                }
            };
        }
        return new ActionMode.Callback() {
            @Override
            public boolean onCreateActionMode(ActionMode mode, Menu menu) {
                cb.onCreateActionMode(mode, menu);
                menu.clear();
                return true;
            }

            @Override
            public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
                cb.onPrepareActionMode(mode, menu);
                menu.clear();
                return true;
            }

            @Override
            public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
                return cb.onActionItemClicked(mode, item);
            }

            @Override
            public void onDestroyActionMode(ActionMode mode) {
                cb.onDestroyActionMode(mode);
            }
        };
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        return super.startActionMode(quiet(callback));
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        return super.startActionMode(quiet(callback), type);
    }

    /**
     * While Frogity has reading to finish (a scan, a Liquid view), the page is told it is still on screen when the app
     * goes to the background or the screen turns off. Otherwise the browser inside the app slows the page's work to a
     * crawl and the reading only moves on while the app is open. The foreground service (with its notification) keeps
     * the app itself alive; this keeps its work going at full speed. Turned off again as soon as the work is done.
     */
    static volatile boolean keepWorking = false;
    static volatile FrogityWebView current;

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        current = this;
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        if (keepWorking && visibility != View.VISIBLE) return;
        super.onWindowVisibilityChanged(visibility);
    }

    @Override
    protected void onVisibilityChanged(View changedView, int visibility) {
        if (keepWorking && visibility != View.VISIBLE) return;
        super.onVisibilityChanged(changedView, visibility);
    }

    /** Work is over: if the app is not on screen any more, the page may now rest like any page in the background. */
    static void letRest() {
        keepWorking = false;
        final FrogityWebView w = current;
        if (w == null) return;
        w.post(() -> {
            int v = w.getWindowVisibility();
            if (v != View.VISIBLE) w.dispatchWindowVisibilityChanged(v);
        });
    }
}
