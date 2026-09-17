package com.swir.xadkiller;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.VpnService;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.os.Process;
import android.system.OsConstants;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.util.Arrays;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class AdBlockVpnServiceV121 extends VpnService {
    public static final String ACTION_START = "com.swir.xadkiller.v121.START";
    public static final String ACTION_STOP = "com.swir.xadkiller.v121.STOP";
    public static final String ACTION_RELOAD = "com.swir.xadkiller.v121.RELOAD";
    public static final String ACTION_STATUS = "com.swir.xadkiller.v121.STATUS";
    public static final String EXTRA_RUNNING = "running";
    public static final String EXTRA_QUERIES = "queries";
    public static final String EXTRA_BLOCKED = "blocked";
    public static final String EXTRA_DOMAINS = "domains";
    public static final String EXTRA_LAST = "last";
    public static final String EXTRA_UPSTREAM = "upstream";
    public static final String KEY_HEARTBEAT = "vpn_heartbeat_v121";

    private static final int NOTIFICATION_ID = 73;
    private static final String CHANNEL_ID = "xadkiller_vpn";
    private static final String VPN_DNS = "10.111.222.1";
    private static final String VPN_CLIENT = "10.111.222.2";
    private static final long HEARTBEAT_INTERVAL_MS = 5_000L;
    private static final DnsUpstreamPool UPSTREAM_POOL = new DnsUpstreamPool(
            new String[]{"1.1.1.1", "9.9.9.9", "8.8.8.8"});

    private final AtomicBoolean workerRunning = new AtomicBoolean(false);
    private final Object heartbeatLock = new Object();
    private volatile ParcelFileDescriptor vpnInterface;
    private volatile Thread worker;
    private volatile ScheduledExecutorService heartbeatExecutor;
    private volatile long queries;
    private volatile long blocked;
    private volatile String lastBlocked = "—";
    private volatile long lastStatusAt;

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        int base = BlocklistManager.bootstrap(this);
        SystemLogStore.info(this, "VPN", "Serwis v1.6.0-dev utworzony • bootstrap=" + base + " domen • lang=" + I18n.language(this));
        SystemLogStore.info(this, "UPSTREAM", "Adaptive DNS pool • " + UPSTREAM_POOL.snapshot(System.currentTimeMillis()));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        SystemLogStore.info(this, "VPN", "onStartCommand • action=" + action + " • startId=" + startId);

        if (ACTION_STOP.equals(action)) {
            SystemLogStore.info(this, "VPN", "Odebrano STOP");
            stopVpn();
            return START_NOT_STICKY;
        }

        if (ACTION_RELOAD.equals(action)) {
            new Thread(() -> {
                int count = BlocklistManager.load(getApplicationContext());
                SystemLogStore.info(this, "BLOCKLIST", "Przeładowano listę w tle • " + count + " domen");
                sendStatus(true);
            }, "xADKiller-Reload").start();
            return workerRunning.get() ? START_STICKY : START_NOT_STICKY;
        }

        startInForeground();
        if (workerRunning.compareAndSet(false, true)) {
            startProtectionPipeline();
        } else {
            SystemLogStore.warn(this, "VPN", "Worker już działa — pomijam drugi start");
            sendStatus(true);
        }
        return START_STICKY;
    }

    @Override public void onDestroy() {
        SystemLogStore.info(this, "VPN", "Serwis niszczony");
        stopVpnInternal(false);
        super.onDestroy();
    }

    @Override public void onRevoke() {
        SystemLogStore.warn(this, "VPN", "Android cofnął zgodę VPN");
        stopVpn();
        super.onRevoke();
    }

    private void startInForeground() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIFICATION_ID, n);
    }

    private Notification buildNotification() {
        PendingIntent openPi = PendingIntent.getActivity(this, 1,
                new Intent(this, MainActivityV121.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stopPi = PendingIntent.getService(this, 2,
                new Intent(this, AdBlockVpnServiceV121.class).setAction(ACTION_STOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_shield_small)
                .setContentTitle(I18n.t(this,"xADKiller aktywny"))
                .setContentText(I18n.dynamic(this,"Ochrona reklam/trackingu • zablokowano: " + blocked))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openPi)
                .addAction(new Notification.Action.Builder(
                        android.R.drawable.ic_menu_close_clear_cancel, I18n.t(this,"Wyłącz"), stopPi).build())
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel c = new NotificationChannel(
                    CHANNEL_ID, "xADKiller VPN", NotificationManager.IMPORTANCE_LOW);
            c.setDescription(I18n.t(this,"Lokalna ochrona DNS przed reklamami, trackerami i złośliwymi domenami"));
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(c);
        }
    }

    /** Loads the large cache off the Android main thread, then starts TUN. */
    private void startProtectionPipeline() {
        worker = new Thread(() -> {
            try {
                SystemLogStore.info(this, "BLOCKLIST", "Ładowanie pełnej listy w tle…");
                int count = BlocklistManager.load(getApplicationContext());
                SystemLogStore.info(this, "BLOCKLIST", "Pełna lista gotowa • " + count + " domen • full=" + BlocklistManager.isFullLoaded());

                PrivateDnsHelper.Snapshot dns = PrivateDnsHelper.inspect(this);
                if (dns.isStrict()) SystemLogStore.warn(this, "PRIVATE_DNS", "Start przy STRICT: " + dns.pretty());

                SystemLogStore.info(this, "VPN", "Budowanie TUN • client=" + VPN_CLIENT + " • dns=" + VPN_DNS);
                Builder b = new Builder()
                        .setSession("xADKiller")
                        .setMtu(1500)
                        .addAddress(VPN_CLIENT, 32)
                        .addRoute(VPN_DNS, 32)
                        .addDnsServer(VPN_DNS);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) b.setMetered(false);

                vpnInterface = b.establish();
                if (vpnInterface == null) throw new IOException("Android nie utworzył interfejsu VPN");

                getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE).edit()
                        .putBoolean("running", true)
                        .putLong(KEY_HEARTBEAT, System.currentTimeMillis())
                        .apply();
                SystemLogStore.info(this, "VPN", "Interfejs VPN utworzony poprawnie");
                startHeartbeat();
                sendStatus(true);
                maybeRefreshBlocklist();
                processPackets(vpnInterface);
            } catch (Throwable e) {
                lastBlocked = "Błąd: " + e.getClass().getSimpleName();
                SystemLogStore.error(this, "VPN", "Worker VPN zakończył się błędem", e);
                sendStatus(true);
            } finally {
                workerRunning.set(false);
                stopHeartbeat();
                closeVpnInterface();
                getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE).edit()
                        .putBoolean("running", false)
                        .putLong(KEY_HEARTBEAT, 0)
                        .apply();
                sendStatus(true);
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
            }
        }, "xADKiller-VPN-Worker");
        worker.start();
    }

    private void startHeartbeat() {
        synchronized (heartbeatLock) {
            stopHeartbeatLocked();
            heartbeatExecutor = Executors.newSingleThreadScheduledExecutor(runnable -> {
                Thread thread = new Thread(runnable, "xADKiller-VPN-Heartbeat");
                thread.setDaemon(true);
                return thread;
            });
            heartbeatExecutor.scheduleAtFixedRate(() -> {
                if (!workerRunning.get() || vpnInterface == null) return;
                try {
                    sendStatus(true);
                } catch (Throwable error) {
                    SystemLogStore.warn(this, "VPN", "Heartbeat status update failed: " + error.getClass().getSimpleName());
                }
            }, HEARTBEAT_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, TimeUnit.MILLISECONDS);
        }
        SystemLogStore.info(this, "VPN", "Traffic-independent heartbeat aktywny • interval=" + HEARTBEAT_INTERVAL_MS + "ms");
    }

    private void stopHeartbeat() {
        synchronized (heartbeatLock) {
            stopHeartbeatLocked();
        }
    }

    private void stopHeartbeatLocked() {
        ScheduledExecutorService executor = heartbeatExecutor;
        heartbeatExecutor = null;
        if (executor != null) executor.shutdownNow();
    }

    private void processPackets(ParcelFileDescriptor pfd) throws IOException {
        try (FileInputStream in = new FileInputStream(pfd.getFileDescriptor());
             FileOutputStream out = new FileOutputStream(pfd.getFileDescriptor())) {
            byte[] packet = new byte[32767];
            while (workerRunning.get()) {
                int len = in.read(packet);
                if (len <= 0) continue;
                DnsPacket.Query q = DnsPacket.parseIpv4UdpQuery(packet, len);
                if (q == null) continue;

                queries++;
                byte[] dnsResponse;
                if (BlocklistManager.isBlocked(q.host)) {
                    blocked++;
                    lastBlocked = q.host;
                    dnsResponse = DnsPacket.nxdomain(q.dnsPayload);
                    writeBlockedLog(q, q.host);
                    SystemLogStore.block(this, "DNS", "BLOCK " + q.host,
                            "srcPort=" + q.sourcePort + " • query#=" + queries);
                } else {
                    if (getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE)
                            .getBoolean(SystemLogStore.PREF_VERBOSE_DNS, false)) {
                        SystemLogStore.dns(this, "ALLOW " + q.host,
                                "srcPort=" + q.sourcePort + " • query#=" + queries);
                    }
                    dnsResponse = forward(q.dnsPayload);
                    if (dnsResponse == null) {
                        SystemLogStore.warn(this, "DNS", "Brak odpowiedzi z upstream dla " + q.host);
                        dnsResponse = DnsPacket.servfail(q.dnsPayload);
                    }
                }

                if (dnsResponse != null) {
                    byte[] responsePacket = DnsPacket.buildIpv4UdpResponse(q, dnsResponse);
                    if (responsePacket != null) {
                        out.write(responsePacket);
                        out.flush();
                    }
                }
                maybeSendStatus();
            }
        }
    }

    private void writeBlockedLog(DnsPacket.Query q, String domain) {
        int uid = findOwnerUid(q);
        String appName = uid == Process.INVALID_UID ? I18n.t(this,"Nieznana aplikacja") : "UID " + uid;
        String packageName = "";
        if (uid != Process.INVALID_UID) {
            try {
                PackageManager pm = getPackageManager();
                String[] packages = pm.getPackagesForUid(uid);
                if (packages != null && packages.length > 0) {
                    packageName = packages[0];
                    ApplicationInfo ai = pm.getApplicationInfo(packageName, 0);
                    CharSequence label = pm.getApplicationLabel(ai);
                    if (label != null && label.length() > 0) appName = label.toString();
                }
            } catch (Exception ignored) {}
        }
        String reason = getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE)
                .getBoolean(BlocklistManager.KEY_STRICT, false) ? "PRO blocklist" : "DNS blocklist";
        LogStore.add(this, new LogStore.Entry(
                System.currentTimeMillis(), uid, appName, packageName, domain, reason));
    }

    private int findOwnerUid(DnsPacket.Query q) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return Process.INVALID_UID;
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return Process.INVALID_UID;
            InetSocketAddress local = new InetSocketAddress(InetAddress.getByAddress(q.sourceIp), q.sourcePort);
            InetSocketAddress remote = new InetSocketAddress(InetAddress.getByAddress(q.destIp), DnsPacket.DNS_PORT);
            return cm.getConnectionOwnerUid(OsConstants.IPPROTO_UDP, local, remote);
        } catch (Exception e) {
            return Process.INVALID_UID;
        }
    }

    private byte[] forward(byte[] query) {
        String lastError = "";
        long orderAt = System.currentTimeMillis();
        for (String server : UPSTREAM_POOL.order(orderAt)) {
            DatagramSocket socket = null;
            long startedNs = System.nanoTime();
            try {
                socket = new DatagramSocket();
                if (!protect(socket)) {
                    lastError = "protect() failed for " + server;
                    UPSTREAM_POOL.recordFailure(server, System.currentTimeMillis());
                    continue;
                }
                socket.setSoTimeout(UPSTREAM_POOL.timeoutMs(server));
                DatagramPacket request = new DatagramPacket(
                        query, query.length, InetAddress.getByName(server), 53);
                socket.send(request);
                byte[] buf = new byte[8192];
                DatagramPacket response = new DatagramPacket(buf, buf.length);
                socket.receive(response);
                if (!DnsPacket.isValidUpstreamResponse(query, buf, response.getLength())) {
                    lastError = "mismatched response from " + server;
                    UPSTREAM_POOL.recordFailure(server, System.currentTimeMillis());
                    SystemLogStore.warn(this, "UPSTREAM", "Odrzucono niepasującą odpowiedź DNS • server=" + server);
                    continue;
                }
                long rttMs = Math.max(1L, (System.nanoTime() - startedNs) / 1_000_000L);
                UPSTREAM_POOL.recordSuccess(server, rttMs, System.currentTimeMillis());
                return Arrays.copyOf(buf, response.getLength());
            } catch (SocketTimeoutException e) {
                lastError = "timeout " + server;
                UPSTREAM_POOL.recordFailure(server, System.currentTimeMillis());
            } catch (Exception e) {
                lastError = server + ": " + e.getClass().getSimpleName() + " " + e.getMessage();
                UPSTREAM_POOL.recordFailure(server, System.currentTimeMillis());
            } finally {
                if (socket != null) socket.close();
            }
        }
        if (!lastError.isEmpty()) {
            SystemLogStore.warn(this, "UPSTREAM", "Wszystkie upstream DNS zawiodły • " + lastError +
                    " • health=" + UPSTREAM_POOL.snapshot(System.currentTimeMillis()));
        }
        return null;
    }

    private void maybeSendStatus() {
        long now = System.currentTimeMillis();
        if (now - lastStatusAt >= 600) {
            sendStatus(false);
            if (blocked > 0 && blocked % 25 == 0) {
                NotificationManager nm = getSystemService(NotificationManager.class);
                if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification());
            }
        }
    }

    private void sendStatus(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastStatusAt < 500) return;
        lastStatusAt = now;
        boolean actuallyRunning = workerRunning.get() && vpnInterface != null;
        getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE).edit()
                .putBoolean("running", actuallyRunning)
                .putLong(KEY_HEARTBEAT, actuallyRunning ? now : 0)
                .putString("dns_upstream_health", UPSTREAM_POOL.snapshot(now))
                .apply();
        Intent i = new Intent(ACTION_STATUS).setPackage(getPackageName());
        i.putExtra(EXTRA_RUNNING, actuallyRunning);
        i.putExtra(EXTRA_QUERIES, queries);
        i.putExtra(EXTRA_BLOCKED, blocked);
        i.putExtra(EXTRA_DOMAINS, BlocklistManager.currentCount());
        i.putExtra(EXTRA_LAST, lastBlocked);
        i.putExtra(EXTRA_UPSTREAM, UPSTREAM_POOL.snapshot(now));
        sendBroadcast(i);
    }

    private void maybeRefreshBlocklist() {
        long last = getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE)
                .getLong(BlocklistManager.KEY_LAST_UPDATE, 0);
        if (System.currentTimeMillis() - last < 3L * 24 * 60 * 60 * 1000) return;
        SystemLogStore.info(this, "BLOCKLIST", "Automatyczna aktualizacja rozpoczęta");
        new Thread(() -> {
            try {
                int count = BlocklistManager.updateRemote(getApplicationContext());
                SystemLogStore.info(this, "BLOCKLIST", "Automatyczna aktualizacja OK • " + count + " domen");
                sendStatus(true);
            } catch (Exception e) {
                SystemLogStore.error(this, "BLOCKLIST", "Automatyczna aktualizacja nieudana", e);
            }
        }, "xADKiller-AutoList").start();
    }

    private void stopVpn() { stopVpnInternal(true); }

    private void stopVpnInternal(boolean self) {
        SystemLogStore.info(this, "VPN", "Zatrzymywanie • queries=" + queries + " • blocked=" + blocked);
        workerRunning.set(false);
        stopHeartbeat();
        closeVpnInterface();
        getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE).edit()
                .putBoolean("running", false)
                .putLong(KEY_HEARTBEAT, 0)
                .apply();
        sendStatus(true);
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (self) stopSelf();
    }

    private void closeVpnInterface() {
        ParcelFileDescriptor p = vpnInterface;
        vpnInterface = null;
        if (p != null) try { p.close(); } catch (IOException ignored) {}
    }
}
