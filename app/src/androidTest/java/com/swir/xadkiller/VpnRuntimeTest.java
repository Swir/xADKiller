package com.swir.xadkiller;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.VpnService;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
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

    private int query(String host) {
        android.os.Bundle result = context.getContentResolver().call(
                android.net.Uri.parse("content://com.swir.xadkiller.probe"), "query", host, null);
        assertNotNull("Separate DNS probe did not return a result", result);
        assertNull("Wire-level DNS probe failed: " + result.getString("error"), result.getString("error"));
        assertTrue("Probe must report a DNS response code", result.containsKey("rcode"));
        return result.getInt("rcode");
    }
}
