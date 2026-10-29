package app.quire.reader;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;

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

    // ------------------------------------------------------------------ open files in place (no copy)

    private JSObject describe(Uri uri) {
        ContentResolver cr = getContext().getContentResolver();
        JSObject o = new JSObject();
        o.put("uri", uri.toString());
        String name = null;
        long size = 0;
        long modified = 0;
        try (Cursor c = cr.query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sz = c.getColumnIndex(OpenableColumns.SIZE);
                int lm = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                if (n >= 0) name = c.getString(n);
                if (sz >= 0 && !c.isNull(sz)) size = c.getLong(sz);
                if (lm >= 0 && !c.isNull(lm)) modified = c.getLong(lm);
            }
        } catch (Exception ignored) {
        }
        if (name == null) name = uri.getLastPathSegment() != null ? uri.getLastPathSegment() : "document";
        o.put("name", name);
        o.put("size", size);
        o.put("modified", modified);
        String mime = cr.getType(uri);
        o.put("mime", mime != null ? mime : "application/octet-stream");
        return o;
    }

    @PluginMethod
    public void pickFiles(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickFilesResult");
    }

    @ActivityCallback
    private void pickFilesResult(PluginCall call, ActivityResult result) {
        JSArray files = new JSArray();
        if (call != null && result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Intent data = result.getData();
            ArrayList<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
            } else if (data.getData() != null) uris.add(data.getData());
            for (Uri u : uris) {
                try {
                    getContext().getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Exception ignored) {
                }
                files.put(describe(u));
            }
        }
        JSObject r = new JSObject();
        r.put("files", files);
        if (call != null) call.resolve(r);
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "pickFolderResult");
    }

    @ActivityCallback
    private void pickFolderResult(PluginCall call, ActivityResult result) {
        JSObject r = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null && result.getData().getData() != null) {
            Uri tree = result.getData().getData();
            try {
                getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {
            }
            r.put("uri", tree.toString());
            String docId = DocumentsContract.getTreeDocumentId(tree);
            String name = docId.contains(":") ? docId.substring(docId.indexOf(':') + 1) : docId;
            if (name.isEmpty()) name = "Storage";
            if (name.contains("/")) name = name.substring(name.lastIndexOf('/') + 1);
            r.put("name", name);
        }
        if (call != null) call.resolve(r);
    }

    private static final String[] DOC_EXT = {"pdf", "epub", "docx", "odt", "rtf", "md", "markdown", "html", "htm", "txt", "csv", "tsv", "xlsx", "ods", "pptx", "odp"};

    private static boolean isDoc(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0) return false;
        String ext = name.substring(dot + 1).toLowerCase();
        for (String e : DOC_EXT) if (e.equals(ext)) return true;
        return false;
    }

    @PluginMethod
    public void listFolder(final PluginCall call) {
        final String treeStr = call.getString("uri");
        if (treeStr == null) {
            call.reject("uri missing");
            return;
        }
        new Thread(() -> {
            JSArray out = new JSArray();
            try {
                Uri tree = Uri.parse(treeStr);
                ContentResolver cr = getContext().getContentResolver();
                java.util.ArrayDeque<String[]> queue = new java.util.ArrayDeque<>();
                queue.add(new String[]{DocumentsContract.getTreeDocumentId(tree), "0"});
                int count = 0;
                while (!queue.isEmpty() && count < 3000) {
                    String[] cur = queue.poll();
                    int depth = Integer.parseInt(cur[1]);
                    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, cur[0]);
                    try (Cursor c = cr.query(children, new String[]{
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                            DocumentsContract.Document.COLUMN_MIME_TYPE,
                            DocumentsContract.Document.COLUMN_SIZE,
                            DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null)) {
                        if (c == null) continue;
                        while (c.moveToNext() && count < 3000) {
                            String id = c.getString(0);
                            String name = c.getString(1);
                            String mime = c.getString(2);
                            if (name == null || name.startsWith(".")) continue;
                            if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                                if (depth < 8) queue.add(new String[]{id, String.valueOf(depth + 1)});
                            } else if (isDoc(name)) {
                                JSObject o = new JSObject();
                                o.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
                                o.put("name", name);
                                o.put("mime", mime != null ? mime : "application/octet-stream");
                                o.put("size", c.isNull(3) ? 0 : c.getLong(3));
                                o.put("modified", c.isNull(4) ? 0 : c.getLong(4));
                                out.put(o);
                                count++;
                            }
                        }
                    }
                }
                JSObject r = new JSObject();
                r.put("files", out);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Couldn't read that folder: " + e.getMessage());
            }
        }).start();
    }

    /** Copies a linked file into the app cache just long enough to read it; returns its path. */
    @PluginMethod
    public void readUri(final PluginCall call) {
        final String uriStr = call.getString("uri");
        if (uriStr == null) {
            call.reject("uri missing");
            return;
        }
        new Thread(() -> {
            try {
                Uri uri = Uri.parse(uriStr);
                File dir = new File(getContext().getCacheDir(), "linked");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File[] old = dir.listFiles();
                long cutoff = System.currentTimeMillis() - 10 * 60 * 1000L;
                if (old != null) for (File f : old) if (f.lastModified() < cutoff) f.delete();
                String name = call.getString("name", "file");
                File f = new File(dir, System.nanoTime() + "-" + name.replaceAll("[\\\\/:*?\"<>|]", "_"));
                ContentResolver cr = getContext().getContentResolver();
                try (InputStream in = cr.openInputStream(uri); OutputStream out = new FileOutputStream(f)) {
                    if (in == null) throw new IllegalStateException("The file can no longer be opened.");
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                JSObject r = new JSObject();
                r.put("path", f.getAbsolutePath());
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Couldn't open the file.");
            }
        }).start();
    }

    /** Switch Android's own text-selection popup on or off (off while reading, on inside text boxes). */
    @PluginMethod
    public void setNativeSelectionMenu(final PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            if (getBridge().getWebView() instanceof QuireWebView) ((QuireWebView) getBridge().getWebView()).setSuppressSelectionMenu(!enabled);
            call.resolve();
        });
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
