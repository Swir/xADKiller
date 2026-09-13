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
import java.util.concurrent.atomic.AtomicBoolean;

public class AdBlockVpnServiceV12 extends VpnService {
    public static final String ACTION_START = "com.swir.xadkiller.v12.START";
    public static final String ACTION_STOP = "com.swir.xadkiller.v12.STOP";
    public static final String ACTION_RELOAD = "com.swir.xadkiller.v12.RELOAD";
    public static final String ACTION_STATUS = "com.swir.xadkiller.v12.STATUS";
    public static final String EXTRA_RUNNING = "running";
    public static final String EXTRA_QUERIES = "queries";
    public static final String EXTRA_BLOCKED = "blocked";
    public static final String EXTRA_DOMAINS = "domains";
    public static final String EXTRA_LAST = "last";

    private static final int NOTIFICATION_ID = 73;
    private static final String CHANNEL_ID = "xadkiller_vpn";
    private static final String VPN_DNS = "10.111.222.1";
    private static final String VPN_CLIENT = "10.111.222.2";
    private static final String[] UPSTREAMS = {"1.1.1.1", "9.9.9.9", "8.8.8.8"};

    private final AtomicBoolean workerRunning = new AtomicBoolean(false);
    private volatile ParcelFileDescriptor vpnInterface;
    private volatile Thread worker;
    private volatile long queries;
    private volatile long blocked;
    private volatile String lastBlocked = "—";
    private volatile long lastStatusAt;

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        BlocklistManager.load(this);
        SystemLogStore.info(this,"VPN","Serwis VPN utworzony");
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        SystemLogStore.info(this,"VPN","onStartCommand • action=" + action + " • startId=" + startId);
        if (ACTION_STOP.equals(action)) { SystemLogStore.info(this,"VPN","Odebrano polecenie STOP"); stopVpn(); return START_NOT_STICKY; }
        if (ACTION_RELOAD.equals(action)) { BlocklistManager.load(this); SystemLogStore.info(this,"BLOCKLIST","Listy przeładowane w serwisie • " + BlocklistManager.currentCount() + " domen"); sendStatus(true); return workerRunning.get() ? START_STICKY : START_NOT_STICKY; }
        PrivateDnsHelper.Snapshot dns = PrivateDnsHelper.inspect(this);
        if (dns.isStrict()) SystemLogStore.warn(this,"PRIVATE_DNS","VPN startuje przy STRICT Private DNS: " + dns.pretty());
        startInForeground();
        if (workerRunning.compareAndSet(false, true)) { startVpnWorker(); maybeRefreshBlocklist(); }
        else SystemLogStore.warn(this,"VPN","Próba ponownego uruchomienia — worker już działa");
        return START_STICKY;
    }

    @Override public void onDestroy() { SystemLogStore.info(this,"VPN","Serwis VPN niszczony"); stopVpnInternal(false); super.onDestroy(); }
    @Override public void onRevoke() { SystemLogStore.warn(this,"VPN","Android cofnął zgodę na VPN"); stopVpn(); super.onRevoke(); }

    private void startInForeground() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIFICATION_ID, n);
    }

    private Notification buildNotification() {
        PendingIntent openPi = PendingIntent.getActivity(this, 1, new Intent(this, MainActivityV12.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stopPi = PendingIntent.getService(this, 2, new Intent(this, AdBlockVpnServiceV12.class).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_shield_small)
                .setContentTitle("xADKiller aktywny")
                .setContentText("Ochrona reklam/trackingu • zablokowano: " + blocked)
                .setOngoing(true).setOnlyAlertOnce(true).setContentIntent(openPi)
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Wyłącz", stopPi).build()).build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel c = new NotificationChannel(CHANNEL_ID, "xADKiller VPN", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("Lokalna ochrona DNS przed reklamami, trackerami i złośliwymi domenami");
            NotificationManager nm = getSystemService(NotificationManager.class); if (nm != null) nm.createNotificationChannel(c);
        }
    }

    private void startVpnWorker() {
        worker = new Thread(() -> {
            try {
                SystemLogStore.info(this,"VPN","Budowanie interfejsu TUN • client="+VPN_CLIENT+" • dns="+VPN_DNS);
                Builder b = new Builder().setSession("xADKiller").setMtu(1500).addAddress(VPN_CLIENT, 32).addRoute(VPN_DNS, 32).addDnsServer(VPN_DNS);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) b.setMetered(false);
                vpnInterface = b.establish(); if (vpnInterface == null) throw new IOException("Android nie utworzył interfejsu VPN");
                SystemLogStore.info(this,"VPN","Interfejs VPN utworzony poprawnie");
                getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE).edit().putBoolean("running", true).apply();
                sendStatus(true); processPackets(vpnInterface);
            } catch (Throwable e) {
                lastBlocked = "Błąd: " + e.getClass().getSimpleName();
                SystemLogStore.error(this,"VPN","Worker VPN zakończył się błędem",e);
                sendStatus(true);
            } finally {
                workerRunning.set(false); closeVpnInterface();
                getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE).edit().putBoolean("running", false).apply();
                sendStatus(true); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
            }
        }, "xADKiller-DNS-Worker");
        worker.start();
    }

    private void processPackets(ParcelFileDescriptor pfd) throws IOException {
        try (FileInputStream in = new FileInputStream(pfd.getFileDescriptor()); FileOutputStream out = new FileOutputStream(pfd.getFileDescriptor())) {
            byte[] packet = new byte[32767];
            while (workerRunning.get()) {
                int len = in.read(packet); if (len <= 0) continue;
                DnsPacket.Query q = DnsPacket.parseIpv4UdpQuery(packet, len); if (q == null) continue;
                queries++;
                byte[] dnsResponse;
                if (BlocklistManager.isBlocked(q.host)) {
                    blocked++; lastBlocked = q.host; dnsResponse = DnsPacket.nxdomain(q.dnsPayload);
                    writeBlockedLog(q, q.host);
                    SystemLogStore.block(this,"DNS","BLOCK " + q.host,"srcPort="+q.sourcePort+" • query#="+queries);
                } else {
                    if (getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE).getBoolean(SystemLogStore.PREF_VERBOSE_DNS, false)) {
                        SystemLogStore.dns(this,"ALLOW " + q.host,"srcPort="+q.sourcePort+" • query#="+queries);
                    }
                    dnsResponse = forward(q.dnsPayload);
                    if (dnsResponse == null) {
                        SystemLogStore.warn(this,"DNS","Brak odpowiedzi z upstream dla " + q.host);
                        dnsResponse = DnsPacket.servfail(q.dnsPayload);
                    }
                }
                if (dnsResponse != null) {
                    byte[] responsePacket = DnsPacket.buildIpv4UdpResponse(q, dnsResponse);
                    if (responsePacket != null) { out.write(responsePacket); out.flush(); }
                }
                maybeSendStatus();
            }
        }
    }

    private void writeBlockedLog(DnsPacket.Query q, String domain) {
        int uid = findOwnerUid(q);
        String appName = uid == Process.INVALID_UID ? "Nieznana aplikacja" : "UID " + uid;
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
        String reason = getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE).getBoolean(BlocklistManager.KEY_STRICT, false) ? "PRO blocklist" : "DNS blocklist";
        LogStore.add(this, new LogStore.Entry(System.currentTimeMillis(), uid, appName, packageName, domain, reason));
    }

    private int findOwnerUid(DnsPacket.Query q) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return Process.INVALID_UID;
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return Process.INVALID_UID;
            InetSocketAddress local = new InetSocketAddress(InetAddress.getByAddress(q.sourceIp), q.sourcePort);
            InetSocketAddress remote = new InetSocketAddress(InetAddress.getByAddress(q.destIp), DnsPacket.DNS_PORT);
            return cm.getConnectionOwnerUid(OsConstants.IPPROTO_UDP, local, remote);
        } catch (Exception e) { return Process.INVALID_UID; }
    }

    private byte[] forward(byte[] query) {
        String lastError = "";
        for (String server : UPSTREAMS) {
            DatagramSocket socket = null;
            try {
                socket = new DatagramSocket();
                if (!protect(socket)) { lastError="protect() failed for "+server; continue; }
                socket.setSoTimeout(2200);
                DatagramPacket request = new DatagramPacket(query, query.length, InetAddress.getByName(server), 53); socket.send(request);
                byte[] buf = new byte[8192]; DatagramPacket response = new DatagramPacket(buf, buf.length); socket.receive(response);
                if (response.getLength() < 12) { lastError="short response from "+server; continue; }
                if (query.length >= 2 && (buf[0] != query[0] || buf[1] != query[1])) { lastError="transaction id mismatch from "+server; continue; }
                return Arrays.copyOf(buf, response.getLength());
            } catch (SocketTimeoutException e) { lastError="timeout "+server; }
            catch (Exception e) { lastError=server+": "+e.getClass().getSimpleName()+" "+e.getMessage(); }
            finally { if (socket != null) socket.close(); }
        }
        if (!lastError.isEmpty()) SystemLogStore.warn(this,"UPSTREAM","Wszystkie upstream DNS zawiodły • "+lastError);
        return null;
    }

    private void maybeSendStatus() {
        long now = System.currentTimeMillis(); if (now - lastStatusAt >= 600) {
            sendStatus(false);
            if (blocked > 0 && blocked % 25 == 0) { NotificationManager nm = getSystemService(NotificationManager.class); if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification()); }
        }
    }

    private void sendStatus(boolean force) {
        long now = System.currentTimeMillis(); if (!force && now - lastStatusAt < 500) return; lastStatusAt = now;
        Intent i = new Intent(ACTION_STATUS).setPackage(getPackageName());
        i.putExtra(EXTRA_RUNNING, workerRunning.get() && vpnInterface != null); i.putExtra(EXTRA_QUERIES, queries); i.putExtra(EXTRA_BLOCKED, blocked);
        i.putExtra(EXTRA_DOMAINS, BlocklistManager.currentCount()); i.putExtra(EXTRA_LAST, lastBlocked); sendBroadcast(i);
    }

    private void maybeRefreshBlocklist() {
        long last = getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE).getLong(BlocklistManager.KEY_LAST_UPDATE, 0);
        if (System.currentTimeMillis() - last < 3L * 24 * 60 * 60 * 1000) return;
        SystemLogStore.info(this,"BLOCKLIST","Automatyczna aktualizacja list rozpoczęta");
        new Thread(() -> { try { int count=BlocklistManager.updateRemote(getApplicationContext()); SystemLogStore.info(this,"BLOCKLIST","Automatyczna aktualizacja OK • "+count+" domen"); sendStatus(true); } catch (Exception e) { SystemLogStore.error(this,"BLOCKLIST","Automatyczna aktualizacja nieudana",e); } }, "xADKiller-AutoList").start();
    }

    private void stopVpn() { stopVpnInternal(true); }
    private void stopVpnInternal(boolean self) {
        SystemLogStore.info(this,"VPN","Zatrzymywanie VPN • self="+self+" • queries="+queries+" • blocked="+blocked);
        workerRunning.set(false); closeVpnInterface();
        getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE).edit().putBoolean("running", false).apply(); sendStatus(true);
        stopForeground(STOP_FOREGROUND_REMOVE); if (self) stopSelf();
    }
    private void closeVpnInterface() { ParcelFileDescriptor p = vpnInterface; vpnInterface = null; if (p != null) try { p.close(); } catch (IOException ignored) {} }
}
