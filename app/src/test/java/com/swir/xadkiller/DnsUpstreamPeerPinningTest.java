package com.swir.xadkiller;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;

import org.junit.Test;

/** Regression for the VPN upstream UDP peer-pinning contract. */
public class DnsUpstreamPeerPinningTest {
    @Test public void connectedUdpSocketIgnoresDatagramFromWrongPeer() throws Exception {
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        try (DatagramSocket client = new DatagramSocket(0, loopback);
             DatagramSocket expected = new DatagramSocket(0, loopback);
             DatagramSocket attacker = new DatagramSocket(0, loopback)) {

            InetSocketAddress expectedPeer = new InetSocketAddress(loopback, expected.getLocalPort());
            client.connect(expectedPeer);
            client.setSoTimeout(1500);

            assertTrue(client.isConnected());
            assertEquals(expectedPeer, client.getRemoteSocketAddress());
            assertNotEquals(expected.getLocalPort(), attacker.getLocalPort());

            byte[] wrong = new byte[]{0x11};
            attacker.send(new DatagramPacket(wrong, wrong.length, loopback, client.getLocalPort()));

            byte[] right = new byte[]{0x22};
            expected.send(new DatagramPacket(right, right.length, loopback, client.getLocalPort()));

            byte[] buf = new byte[8];
            DatagramPacket received = new DatagramPacket(buf, buf.length);
            client.receive(received);

            assertEquals(expected.getLocalPort(), received.getPort());
            assertEquals(1, received.getLength());
            assertEquals(0x22, received.getData()[received.getOffset()] & 0xFF);
        }
    }
}
