package com.swir.xadkiller.probe;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.os.Binder;
import android.os.SystemClock;
import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;

/** Separate disposable test APK: ordinary client UID, never shipped in the release. */
public final class DnsProbeProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }

    @Override public Bundle call(String method, String host, Bundle extras) {
        if (!"query".equals(method) || !("example.com".equals(host) || "doubleclick.net".equals(host)))
            throw new IllegalArgumentException("Unsupported test fixture");
        Bundle result = new Bundle();
        long identity = Binder.clearCallingIdentity();
        try {
            ConnectivityManager manager = getContext().getSystemService(ConnectivityManager.class);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            int id = (int)System.nanoTime() & 0xffff;
            bytes.write(new byte[]{(byte)(id >> 8), (byte)id, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0});
            for (String label : host.split("\\.")) {
                byte[] value = label.getBytes(StandardCharsets.US_ASCII);
                bytes.write(value.length); bytes.write(value);
            }
            bytes.write(new byte[]{0, 0, 1, 0, 1});
            byte[] payload = bytes.toByteArray();
            try (DatagramSocket socket = sendWhenRouteReady(manager, payload)) {
                byte[] response = new byte[8192];
                DatagramPacket packet = new DatagramPacket(response, response.length);
                socket.receive(packet);
                if (packet.getLength() < 12 || id != (((response[0] & 255) << 8) | (response[1] & 255))
                        || (response[2] & 128) == 0) throw new IllegalStateException("Invalid DNS response");
                int code = response[3] & 15;
                if (code == 0 && response[6] == 0 && response[7] == 0)
                    throw new IllegalStateException("Successful A query without answers");
                result.putInt("rcode", code);
            }
        } catch (Exception error) {
            result.putString("error", error.toString());
        } finally {
            Binder.restoreCallingIdentity(identity);
        }
        return result;
    }

    private static DatagramSocket sendWhenRouteReady(ConnectivityManager manager, byte[] payload) throws Exception {
        // establish() can return before netd has applied the new network's UID ranges.
        // Wait for route access; never retry or reinterpret the DNS response itself.
        long deadline = SystemClock.elapsedRealtime() + 5000;
        Exception last = null;
        while (SystemClock.elapsedRealtime() < deadline) {
            Network network = manager.getActiveNetwork();
            if (network != null) {
                NetworkCapabilities caps = manager.getNetworkCapabilities(network);
                if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                    DatagramSocket socket = new DatagramSocket();
                    try {
                        network.bindSocket(socket);
                        socket.setSoTimeout(12_000);
                        socket.connect(InetAddress.getByName("10.111.222.1"), 53);
                        socket.send(new DatagramPacket(payload, payload.length));
                        return socket;
                    } catch (java.io.IOException error) {
                        socket.close();
                        // Before a successful send, Android may still be applying UID rules.
                        // Do not retry a timeout or reinterpret any received DNS response.
                        if (!error.toString().contains("EPERM")) throw error;
                        last = error;
                    }
                }
            }
            SystemClock.sleep(50);
        }
        throw new IllegalStateException("VPN route access did not become available", last);
    }

    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) { return null; }
    @Override public String getType(Uri u) { return null; }
    @Override public Uri insert(Uri u, ContentValues v) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri u, String s, String[] a) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { throw new UnsupportedOperationException(); }
}
