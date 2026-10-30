package com.swir.xadkiller;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.VpnService;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.function.BooleanSupplier;
import static org.junit.Assert.*;

/** Run on a disposable emulator with ACTIVATE_VPN granted to the test package. */
@RunWith(AndroidJUnit4.class)
public class VpnRuntimeTest {
    private Context context;
    private SharedPreferences prefs;
    private Activity activity;

    @Before public void prepare() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        prefs = context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE);
        // Make these tests independent of live blocklist downloads.
        prefs.edit().putLong(BlocklistManager.KEY_LAST_UPDATE, System.currentTimeMillis()).commit();
        DnsPause.resume(context);
        assertNull("Grant ACTIVATE_VPN to the disposable test app before running", VpnService.prepare(context));
        activity = InstrumentationRegistry.getInstrumentation().startActivitySync(
                new Intent(context, MainActivityV121.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    @After public void cleanup() throws Exception {
        stop();
        BlocklistManager.removeRule(context, "example.com", true);
        BlocklistManager.removeRule(context, "example.com", false);
        prefs.edit().remove(BlocklistManager.KEY_LAST_UPDATE).commit();
        if (activity != null) InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish);
    }

    @Test public void actualTunBlocksAdsAndForwardsBenignDns() throws Exception {
        start();
        assertEquals("Ad query must be NXDOMAIN through the real TUN", 3, query("doubleclick.net"));
        assertEquals("Benign query must resolve through protected upstream socket", 0, query("example.com"));
        await(() -> prefs.getLong("dns_blocked", 0) > 0, 6500);
    }

    @Test public void customRulesCanBeAddedReversedAndRemovedWhileVpnRuns() throws Exception {
        start();
        BlocklistManager.addCustomBlock(context, "example.com");
        assertEquals(3, query("example.com"));
        BlocklistManager.addAllow(context, "example.com");
        assertEquals(0, query("example.com"));
        BlocklistManager.removeRule(context, "example.com", true);
        assertEquals("Removing exception must not resurrect an obsolete custom block", 0, query("example.com"));
        assertEquals(3, query("doubleclick.net"));
        assertTrue(prefs.getBoolean("running", false));
    }

    @Test public void pauseAndExpiryPreserveDnsConnectivityAndResumeBlocking() throws Exception {
        start();
        BlocklistManager.addCustomBlock(context, "example.com");
        assertEquals(3, query("example.com"));
        DnsPause.pause(context, 5);
        assertEquals(0, query("example.com"));
        assertTrue(prefs.getBoolean("running", false));
        prefs.edit().putLong(DnsPause.KEY_UNTIL, System.currentTimeMillis() + 250).commit();
        SystemClock.sleep(400);
        assertEquals("Deadline expiry resumes filtering without reopening the UI", 3, query("example.com"));
        DnsPause.pause(context, 15);
        DnsPause.resume(context);
        assertEquals(3, query("example.com"));
    }

    @Test public void rapidStartStopCannotResurrectCancelledVpn() throws Exception {
        for (int i = 0; i < 8; i++) {
            context.startForegroundService(new Intent(context, AdBlockVpnServiceV121.class)
                    .setAction(AdBlockVpnServiceV121.ACTION_START));
            context.startService(new Intent(context, AdBlockVpnServiceV121.class)
                    .setAction(AdBlockVpnServiceV121.ACTION_STOP));
            SystemClock.sleep(150);
        }
        SystemClock.sleep(1500);
        assertFalse("Stopped startup worker must not establish a tunnel later", prefs.getBoolean("running", false));
        start();
        assertEquals(3, query("doubleclick.net"));
        stop();
        SystemClock.sleep(6000);
        assertFalse(prefs.getBoolean("running", false));
        assertEquals(0, prefs.getLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, -1));
    }

    @Test public void idleHeartbeatAndActivityRecreationKeepProtectionAndCounters() throws Exception {
        start();
        assertEquals(3, query("doubleclick.net"));
        long before = prefs.getLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0);
        SystemClock.sleep(6500);
        assertTrue("Idle TUN needs a traffic-independent heartbeat",
                prefs.getLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0) > before);
        long blocks = prefs.getLong("dns_blocked", 0);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::recreate);
        SystemClock.sleep(1500);
        assertTrue(prefs.getBoolean("running", false));
        assertTrue(prefs.getLong("dns_blocked", 0) >= blocks);
        assertEquals(0, query("example.com"));
    }

    private void start() throws Exception {
        context.startForegroundService(new Intent(context, AdBlockVpnServiceV121.class)
                .setAction(AdBlockVpnServiceV121.ACTION_START));
        await(() -> prefs.getBoolean("running", false)
                && prefs.getLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0) > 0, 15_000);
    }

    private void stop() throws Exception {
        context.startService(new Intent(context, AdBlockVpnServiceV121.class)
                .setAction(AdBlockVpnServiceV121.ACTION_STOP));
        await(() -> !prefs.getBoolean("running", false), 5000);
        SystemClock.sleep(200);
    }

    private static void await(BooleanSupplier condition, long timeout) throws Exception {
        long end = SystemClock.elapsedRealtime() + timeout;
        while (!condition.getAsBoolean() && SystemClock.elapsedRealtime() < end) SystemClock.sleep(50);
        assertTrue("VPN state did not converge before timeout", condition.getAsBoolean());
    }

    private int query(String host) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int id = (int) System.nanoTime() & 0xffff;
        bytes.write(new byte[]{(byte)(id >> 8), (byte)id, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0});
        for (String label : host.split("\\.")) {
            byte[] value = label.getBytes(StandardCharsets.US_ASCII);
            bytes.write(value.length); bytes.write(value);
        }
        bytes.write(new byte[]{0, 0, 1, 0, 1});
        byte[] payload = bytes.toByteArray();
        try (DatagramSocket socket = new DatagramSocket()) {
            // Android exempts the VPN provider UID from default VPN routing. Bind this
            // in-process probe explicitly to the VPN, as an ordinary protected app routes.
            ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
            Network vpn = null;
            long deadline = SystemClock.elapsedRealtime() + 5000;
            while (vpn == null && SystemClock.elapsedRealtime() < deadline) {
                for (Network network : manager.getAllNetworks()) {
                    NetworkCapabilities caps = manager.getNetworkCapabilities(network);
                    if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) vpn = network;
                }
                if (vpn == null) SystemClock.sleep(50);
            }
            assertNotNull("VPN network must be registered before a wire-level probe", vpn);
            vpn.bindSocket(socket);
            socket.setSoTimeout(12_000);
            socket.connect(InetAddress.getByName("10.111.222.1"), 53);
            socket.send(new DatagramPacket(payload, payload.length));
            byte[] response = new byte[8192];
            DatagramPacket packet = new DatagramPacket(response, response.length);
            socket.receive(packet);
            assertTrue(packet.getLength() >= 12);
            assertEquals(id, ((response[0] & 255) << 8) | (response[1] & 255));
            assertTrue((response[2] & 128) != 0);
            int code = response[3] & 15;
            if (code == 0) assertTrue("Successful A query must have an answer", response[6] != 0 || response[7] != 0);
            return code;
        }
    }
}
