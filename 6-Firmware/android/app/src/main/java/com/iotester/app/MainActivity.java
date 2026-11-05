/*
  IO Tester — app Android / Android app
  IT: Contenitore WebView dell'interfaccia dello strumento (http://192.168.4.1). Da Android 10 si collega
      da sola all'Access Point "IO-Tester" (WifiNetworkSpecifier, l'utente conferma) e lega il traffico
      dell'app a quella rete, così le richieste non escono sui dati mobili. Se la rete manca o cade mostra
      una schermata con "Riprova" e "Impostazioni WiFi" e ricontrolla ogni 3 s (anche un collegamento fatto
      a mano dalle impostazioni); se lo strumento è spento rinnova la richiesta di rete da sola per 15 minuti. Chiudendo l'app la rete viene rilasciata e lo
      strumento spegne le uscite da solo (nessun dispositivo collegato per 2 s).
  EN: WebView container for the instrument interface (http://192.168.4.1). From Android 10 it connects
      by itself to the "IO-Tester" Access Point (WifiNetworkSpecifier, the user confirms) and binds the app
      traffic to that network, so requests do not go out on mobile data. If the network is missing or
      drops it shows a screen with "Retry" and "WiFi settings" and checks again every 3 s (also a connection
      made by hand from settings); if the instrument is off it renews the network request by itself for 15 minutes. Closing the app releases the network and
      the instrument switches its outputs off by itself (no device connected for 2 s).
*/
package com.iotester.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.widget.Toast;
import android.net.wifi.WifiNetworkSpecifier;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.URL;
import java.util.Locale;

public class MainActivity extends Activity {
    private int navInset;      // IT: barra di navigazione in px CSS / EN: navigation bar in CSS px
    private int splashPad;     // IT: margine originale della schermata di avvio / EN: original splash padding
    private View root;         // IT: contenitore (il suo sfondo è dietro la barra di stato) / EN: container (its background is behind the status bar)

    private static final String SSID = "IO-Tester";
    private static final String PASSWORD = "calibra123";
    private static final String URL = "http://192.168.4.1/";
    private static final String PROBE = "http://192.168.4.1/api/state";
    private static final long WATCH_MS = 3000;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private ConnectivityManager cm;
    private ConnectivityManager.NetworkCallback callback;
    private WebView web;
    private View splash;
    private ProgressBar progress;
    private TextView status, hint;
    private Button retry, settings;
    private boolean pageShown = false;
    private boolean watching = false;
    private static final long REQUEST_MS = 30000;          // IT: durata di una richiesta di rete / EN: duration of one network request
    private static final long SEARCH_MAX_MS = 15 * 60000;  // IT: ricerca automatica per 15 min / EN: automatic search for 15 min
    private long requestStart = 0;   // IT: inizio della richiesta in corso / EN: start of the current request
    private long searchStart = 0;    // IT: inizio della ricerca automatica (0 = ferma) / EN: start of the automatic search (0 = stopped)
    private final Runnable reRequest = this::requestInstrumentNetwork;
    private static final int PICK_FILE = 1;
    private ValueCallback<Uri[]> fileCallback;   // IT: scelta file in corso / EN: file choice in progress   // IT: ricerca periodica attiva / EN: periodic search active

    /**
     * IT: Prepara viste, WebView e insets; poi avvia il collegamento.
     * EN: Sets up views, WebView and insets; then starts the connection.
     */
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);   // IT: lavoro sul campo / EN: field work

        cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        web = findViewById(R.id.web);
        splash = findViewById(R.id.splash);
        progress = findViewById(R.id.progress);
        status = findViewById(R.id.status);
        hint = findViewById(R.id.hint);
        retry = findViewById(R.id.retry);
        settings = findViewById(R.id.settings);

        // IT: margini per barra di stato e tastiera (edge-to-edge da Android 15). La pagina si estende sotto la barra
        //     di navigazione, la cui altezza le arriva come --sab: niente fascia vuota sotto la barra dei pulsanti.
        // EN: padding for status bar and keyboard (edge-to-edge from Android 15). The page extends beneath the
        //     navigation bar, whose height reaches it as --sab: no empty strip below the button bar.
        root = findViewById(R.id.root);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int nav = insets.getSystemWindowInsetBottom();
            int ime = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                nav = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
                ime = insets.getInsets(WindowInsets.Type.ime()).bottom;
            }
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), ime);
            splash.setPadding(splashPad, splashPad, splashPad, splashPad + nav);
            navInset = ime > 0 ? 0 : Math.round(nav / getResources().getDisplayMetrics().density);
            applyNavInset();
            return insets;
        });

        splashPad = splash.getPaddingTop();
        // IT: barre di sistema trasparenti, senza la banda grigia dietro i tasti di Android
        // EN: transparent system bars, without the grey band behind the Android buttons
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
        setupWebView();
        retry.setOnClickListener(v -> connect());
        settings.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS)));
        connect();
    }

    /**
     * IT: Configura la WebView: JavaScript e localStorage (tema, lingua), niente zoom, errori → schermata.
     * EN: Configures the WebView: JavaScript and localStorage (theme, language), no zoom, errors → screen.
     */
    private void setupWebView() {
        web.addJavascriptInterface(new AppBridge(), "IOTesterApp");
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setWebChromeClient(new WebChromeClient() {
            // IT: conferme della pagina (cancella calibrazione, elimina NVS, test SPI) come finestre Android
            // EN: page confirmations (clear calibration, erase NVS, SPI test) as Android dialogs
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.confirm())
                        .show();
                return true;
            }

            // IT: <input type="file"> della pagina Info app (firmware.bin, littlefs.bin)
            // EN: <input type="file"> of the App info page (firmware.bin, littlefs.bin)
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");   // IT: i .bin non hanno un tipo MIME affidabile / EN: .bin files have no reliable MIME type
                try {
                    startActivityForResult(i, PICK_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        // IT: download dalla pagina (copia JSON dei coefficienti, link data:) salvato in Download
        // EN: downloads from the page (JSON coefficient copy, data: link) saved to Downloads
        web.setDownloadListener((url, ua, disposition, mime, length) -> saveDataUrl(url, disposition));
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                // IT: solo pagine dello strumento nella WebView / EN: only instrument pages inside the WebView
                String host = req.getUrl().getHost();
                return host != null && !host.equals("192.168.4.1") && !host.equals("iotester.local");
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap icon) {
                if (!pageShown) showState(R.string.loading, R.string.connecting_hint, true, false);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageShown = true;
                applyNavInset();
                web.setVisibility(View.VISIBLE);
                splash.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    pageShown = false;
                    showState(R.string.not_found, R.string.not_found_hint, false, true);
                }
            }
        });
    }

    /**
     * IT: Funzioni chiamate dalla pagina (theme.js). EN: Functions called by the page (theme.js).
     */
    private class AppBridge {
        /**
         * IT: Il tema della pagina è cambiato: colori delle barre di sistema e delle loro icone.
         * EN: The page theme changed: system bar colours and their icon colours.
         */
        @JavascriptInterface
        public void setTheme(boolean dark) {
            ui.post(() -> applySystemBars(dark));
        }
    }

    /**
     * IT: Sfondo dietro la barra di stato uguale alla pagina (#0b1220 scuro, #f3f5f9 chiaro); icone di stato e tasti di
     *     Android chiare sul tema scuro e scure sul tema chiaro.
     * EN: Background behind the status bar matching the page (#0b1220 dark, #f3f5f9 light); status icons and Android
     *     buttons light on the dark theme and dark on the light theme.
     */
    @SuppressWarnings("deprecation")
    private void applySystemBars(boolean dark) {
        int bg = dark ? 0xFF0B1220 : 0xFFF3F5F9;
        root.setBackgroundColor(bg);
        getWindow().setStatusBarColor(bg);           // IT/EN: solo prima di Android 15 / only before Android 15
        getWindow().setNavigationBarColor(bg);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            getWindow().getInsetsController().setSystemBarsAppearance(dark ? 0 : light, light);
        } else {
            View d = getWindow().getDecorView();
            int f = d.getSystemUiVisibility() & ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            if (!dark) f |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
            d.setSystemUiVisibility(f);
        }
    }

    /**
     * IT: Passa alla pagina l'altezza della barra di navigazione (px CSS) come variabile --sab.
     * EN: Passes the navigation bar height (CSS px) to the page as the --sab variable.
     */
    private void applyNavInset() {
        if (web == null) return;
        web.evaluateJavascript("document.documentElement.style.setProperty('--sab','" + navInset + "px')", null);
    }

    /**
     * IT: Risultato della scelta file: lo passa alla pagina (null = annullata).
     * EN: File choice result: passes it to the page (null = cancelled).
     */
    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == PICK_FILE && fileCallback != null) {
            Uri u = result == RESULT_OK && data != null ? data.getData() : null;
            fileCallback.onReceiveValue(u != null ? new Uri[]{u} : null);
            fileCallback = null;
            return;
        }
        super.onActivityResult(request, result, data);
    }

    /**
     * IT: Salva un link data: (JSON della pagina) nella cartella Download (Android 10+); nome dal Content-Disposition.
     * EN: Saves a data: link (page JSON) to the Downloads folder (Android 10+); name from Content-Disposition.
     */
    private void saveDataUrl(String url, String disposition) {
        if (!url.startsWith("data:") || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Toast.makeText(this, "Download non supportato", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            int comma = url.indexOf(',');
            String meta = url.substring(5, comma);
            String payload = url.substring(comma + 1);
            byte[] bytes = meta.endsWith(";base64") ? Base64.decode(payload, Base64.DEFAULT)
                    : URLDecoder.decode(payload.replace("+", "%2B"), "UTF-8").getBytes("UTF-8");
            String name = "iotester.json";
            if (disposition != null && disposition.contains("filename=")) {
                name = disposition.substring(disposition.indexOf("filename=") + 9).replace("\"", "").trim();
            }
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, name);
            v.put(MediaStore.Downloads.MIME_TYPE, "application/json");
            Uri dst = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            try (OutputStream out = getContentResolver().openOutputStream(dst)) {
                out.write(bytes);
            }
            Toast.makeText(this, "Download/" + name, Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /**
     * IT: Mostra la schermata di stato; buttons = pulsanti Riprova e Impostazioni visibili.
     * EN: Shows the state screen; buttons = Retry and Settings buttons visible.
     */
    private void showState(int title, int text, boolean busy, boolean buttons) {
        web.setVisibility(View.INVISIBLE);
        splash.setVisibility(View.VISIBLE);
        status.setText(title);
        hint.setText(text);
        progress.setVisibility(busy ? View.VISIBLE : View.INVISIBLE);
        retry.setVisibility(buttons ? View.VISIBLE : View.GONE);
        settings.setVisibility(buttons ? View.VISIBLE : View.GONE);
        if (buttons) startWatch();
    }

    /**
     * IT: Ogni 3 s cerca lo strumento su una rete già collegata (anche a mano dalle impostazioni) e, se risponde, apre l'interfaccia.
     * EN: Every 3 s looks for the instrument on an already connected network (also by hand from settings) and, if it answers, opens the interface.
     */
    private void startWatch() {
        if (watching) return;
        watching = true;
        ui.postDelayed(watchTick, WATCH_MS);
    }

    private final Runnable watchTick = new Runnable() {
        @Override
        public void run() {
            if (!watching || pageShown) {
                watching = false;
                return;
            }
            new Thread(() -> {
                Network n = findInstrument();
                ui.post(() -> {
                    if (!watching) return;
                    if (n != null) {
                        watching = false;
                        useNetwork(n);
                    } else {
                        ui.postDelayed(watchTick, WATCH_MS);
                    }
                });
            }).start();
        }
    };

    /**
     * IT: Rete WiFi con indirizzo 192.168.4.x su cui /api/state risponde con il campo "fw" dello strumento; null se nessuna.
     *     Va chiamata fuori dal thread dell'interfaccia (richiesta HTTP con timeout di 1,5 s).
     * EN: WiFi network with a 192.168.4.x address where /api/state answers with the instrument "fw" field; null if none.
     *     Must be called off the UI thread (HTTP request with a 1.5 s timeout).
     */
    private Network findInstrument() {
        for (Network n : cm.getAllNetworks()) {
            NetworkCapabilities c = cm.getNetworkCapabilities(n);
            LinkProperties lp = cm.getLinkProperties(n);
            if (c == null || lp == null || !c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
            boolean subnet = false;
            for (LinkAddress la : lp.getLinkAddresses()) {
                if (la.getAddress() instanceof Inet4Address && la.getAddress().getHostAddress().startsWith("192.168.4.")) subnet = true;
            }
            if (subnet && probe(n)) return n;
        }
        return null;
    }

    /**
     * IT: true se sulla rete n risponde lo strumento (evita di aprire per sbaglio un router con la stessa sottorete).
     * EN: true if the instrument answers on network n (avoids opening by mistake a router with the same subnet).
     */
    private boolean probe(Network n) {
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) n.openConnection(new URL(PROBE));
            h.setConnectTimeout(1500);
            h.setReadTimeout(1500);
            if (h.getResponseCode() != 200) return false;
            byte[] buf = new byte[256];
            int len;
            try (InputStream in = h.getInputStream()) {
                len = in.read(buf);
            }
            return len > 0 && new String(buf, 0, len, "UTF-8").contains("\"fw\"");
        } catch (Exception e) {
            return false;
        } finally {
            if (h != null) h.disconnect();
        }
    }

    /**
     * IT: Lega il traffico dell'app alla rete dello strumento e apre l'interfaccia.
     * EN: Binds the app traffic to the instrument network and opens the interface.
     */
    private void useNetwork(Network n) {
        cm.bindProcessToNetwork(n);
        load();
    }

    /**
     * IT: Collega il telefono all'AP: da Android 10 con WifiNetworkSpecifier, prima cerca una rete WiFi già attiva.
     * EN: Connects the phone to the AP: from Android 10 with WifiNetworkSpecifier, before that looks for an active WiFi network.
     */
    private void connect() {
        pageShown = false;
        watching = false;
        ui.removeCallbacks(reRequest);
        searchStart = System.currentTimeMillis();
        showState(R.string.connecting, R.string.connecting_hint, true, false);
        release();
        // IT: 1) telefono già collegato allo strumento (anche a mano)? Allora niente richiesta ad Android
        // EN: 1) phone already connected to the instrument (also by hand)? Then no request to Android
        new Thread(() -> {
            Network n = findInstrument();
            ui.post(() -> {
                if (n != null) useNetwork(n);
                else requestInstrumentNetwork();
            });
        }).start();
    }

    /**
     * IT: 2) Chiede ad Android di collegarsi a "IO-Tester" (Android 10+); su Android 7–9 serve il collegamento manuale.
     * EN: 2) Asks Android to connect to "IO-Tester" (Android 10+); on Android 7–9 a manual connection is needed.
     */
    private void requestInstrumentNetwork() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            showState(R.string.not_found, R.string.old_android, false, true);
            return;
        }
        if (pageShown) return;
        unregister();
        requestStart = System.currentTimeMillis();

        WifiNetworkSpecifier spec = new WifiNetworkSpecifier.Builder()
                .setSsid(SSID)
                .setWpa2Passphrase(PASSWORD)
                .build();
        NetworkRequest req = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)   // IT: l'AP non ha internet / EN: the AP has no internet
                .setNetworkSpecifier(spec)
                .build();
        final ConnectivityManager.NetworkCallback cb = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                // IT: tutto il traffico dell'app su questa rete / EN: all app traffic on this network
                ui.post(() -> {
                    if (callback == this) useNetwork(network);
                });
            }

            @Override
            public void onUnavailable() {
                ui.post(() -> {
                    if (callback == this) onSearchFailed();
                });
            }

            @Override
            public void onLost(Network network) {
                cm.bindProcessToNetwork(null);
                ui.post(() -> {
                    if (callback != this) return;
                    // IT: strumento spento o riavviato (es. dopo un aggiornamento): si riparte a cercarlo da soli
                    // EN: instrument off or restarted (e.g. after an update): the search restarts by itself
                    pageShown = false;
                    showState(R.string.lost, R.string.searching_hint, true, true);
                    searchStart = System.currentTimeMillis();
                    ui.postDelayed(reRequest, 2000);
                });
            }
        };
        callback = cb;
        cm.requestNetwork(req, cb, (int) REQUEST_MS);
    }

    /**
     * IT: Richiesta di rete senza esito. Se è scaduta dopo i 30 s (strumento spento o lontano) la si rinnova da sola
     *     per 15 minuti; se è finita prima, l'utente ha annullato la finestra di Android: si mostrano i pulsanti.
     * EN: Network request without result. If it expired after 30 s (instrument off or far) it is renewed automatically
     *     for 15 minutes; if it ended earlier, the user cancelled the Android dialog: the buttons are shown.
     */
    private void onSearchFailed() {
        long now = System.currentTimeMillis();
        boolean expired = now - requestStart >= REQUEST_MS - 5000;
        if (!pageShown && expired && searchStart != 0 && now - searchStart < SEARCH_MAX_MS) {
            showState(R.string.searching, R.string.searching_hint, true, true);
            ui.postDelayed(reRequest, 1500);
            return;
        }
        searchStart = 0;
        showState(R.string.not_found, R.string.not_found_hint, false, true);
    }

    /**
     * IT: Annulla la richiesta di rete in corso (senza toccare il legame del traffico). EN: Cancels the current network request (traffic binding untouched).
     */
    private void unregister() {
        if (callback != null) {
            try {
                cm.unregisterNetworkCallback(callback);
            } catch (IllegalArgumentException ignored) {
                // IT: già rilasciata / EN: already released
            }
            callback = null;
        }
    }

    /**
     * IT: Apre l'interfaccia; al primo avvio passa la lingua del telefono (?lang=it|en), poi decide la pagina.
     * EN: Opens the interface; on first start passes the phone language (?lang=it|en), then the page decides.
     */
    private void load() {
        SharedPreferences p = getSharedPreferences("app", MODE_PRIVATE);
        String url = URL;
        if (!p.getBoolean("lang_set", false)) {
            url += "?lang=" + ("it".equals(Locale.getDefault().getLanguage()) ? "it" : "en");
            p.edit().putBoolean("lang_set", true).apply();
        }
        web.loadUrl(url);
    }

    /**
     * IT: Rilascia la richiesta di rete e il legame del traffico. EN: Releases the network request and the traffic binding.
     */
    private void release() {
        unregister();
        cm.bindProcessToNetwork(null);
    }

    /**
     * IT: Indietro: pagina precedente dell'interfaccia, altrimenti esce. EN: Back: previous interface page, otherwise exits.
     */
    @Override
    public void onBackPressed() {
        if (pageShown && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /**
     * IT: Uscendo dall'app si rilascia la rete: lo strumento spegne le uscite da solo.
     * EN: Leaving the app releases the network: the instrument switches its outputs off by itself.
     */
    @Override
    protected void onDestroy() {
        watching = false;
        ui.removeCallbacks(watchTick);
        ui.removeCallbacks(reRequest);
        release();
        web.destroy();
        super.onDestroy();
    }
}
