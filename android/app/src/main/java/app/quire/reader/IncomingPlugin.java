package app.quire.reader;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/**
 * Receives files opened with Quire ("Open with…") or shared to it, copies them into the app cache
 * and hands their paths to the web layer through the "file" event.
 */
@CapacitorPlugin(name = "Incoming")
public class IncomingPlugin extends Plugin {

    private static Intent launchIntent;

    static void setLaunchIntent(Intent intent) {
        launchIntent = intent;
    }

    @Override
    public void load() {
        if (launchIntent != null) {
            Intent i = launchIntent;
            launchIntent = null;
            process(i);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        process(intent);
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        // Files are delivered through the retained "file" event; nothing is queued here.
        JSObject r = new JSObject();
        r.put("files", new JSArray());
        call.resolve(r);
    }

    private void process(final Intent intent) {
        if (intent == null) return;
        final String action = intent.getAction();
        if (!Intent.ACTION_VIEW.equals(action) && !Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        new Thread(() -> {
            JSArray files = new JSArray();
            try {
                ArrayList<Uri> uris = new ArrayList<>();
                if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
                    uris.add(intent.getData());
                } else if (Intent.ACTION_SEND.equals(action)) {
                    Uri u = getStream(intent);
                    if (u != null) uris.add(u);
                    else {
                        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                        if (text != null) {
                            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                            String name = (subject != null && !subject.isEmpty() ? subject : "Shared text") + ".txt";
                            File f = target(name);
                            try (OutputStream out = new FileOutputStream(f)) {
                                out.write(text.toString().getBytes(StandardCharsets.UTF_8));
                            }
                            files.put(entry(f, name, "text/plain"));
                        }
                    }
                } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                    ArrayList<Uri> list = getStreams(intent);
                    if (list != null) uris.addAll(list);
                }
                for (Uri uri : uris) {
                    JSObject e = copy(uri);
                    if (e != null) files.put(e);
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
            if (files.length() > 0) {
                JSObject r = new JSObject();
                r.put("files", files);
                notifyListeners("file", r, true);
            }
        }).start();
        // don't re-import if the activity is recreated
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
    }

    @SuppressWarnings("deprecation")
    private Uri getStream(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    private ArrayList<Uri> getStreams(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
    }

    private JSObject copy(Uri uri) {
        ContentResolver cr = getContext().getContentResolver();
        String name = null;
        try (Cursor c = cr.query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) name = c.getString(idx);
            }
        } catch (Exception ignored) {
        }
        if (name == null) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "document";
        name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        String mime = cr.getType(uri);
        if (mime == null) {
            String ext = MimeTypeMap.getFileExtensionFromUrl(name);
            mime = ext != null ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase()) : null;
        }
        if (mime == null) mime = "application/octet-stream";
        if (!name.contains(".")) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (ext != null) name = name + "." + ext;
        }
        try {
            File f = target(name);
            try (InputStream in = cr.openInputStream(uri); OutputStream out = new FileOutputStream(f)) {
                if (in == null) return null;
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return entry(f, name, mime);
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    private File target(String name) {
        File dir = new File(getContext().getCacheDir(), "incoming/" + System.currentTimeMillis());
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return new File(dir, name);
    }

    private JSObject entry(File f, String name, String mime) {
        JSObject o = new JSObject();
        o.put("path", f.getAbsolutePath());
        o.put("name", name);
        o.put("mime", mime);
        return o;
    }
}
