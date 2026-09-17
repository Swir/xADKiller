package com.swir.xadkiller;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import org.junit.Test;

public class DnsPacketHardeningTest {
    @Test public void acceptsCompleteStandardSingleQuestionDnsQuery() {
        byte[] packet = packet(query(0x0100, 1), 53000, 0x4000);
        DnsPacket.Query parsed = DnsPacket.parseIpv4UdpQuery(packet, packet.length);
        assertNotNull(parsed);
        assertEquals("ads.example.com", parsed.host);
        assertEquals(53000, parsed.sourcePort);
    }

    @Test public void rejectsFirstFragmentWithMoreFragmentsFlag() {
        byte[] packet = packet(query(0x0100, 1), 53000, 0x2000);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet, packet.length));
    }

    @Test public void rejectsNonInitialFragment() {
        byte[] packet = packet(query(0x0100, 1), 53000, 0x0001);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet, packet.length));
    }

    @Test public void rejectsTruncatedIpv4LengthClaim() {
        byte[] packet = packet(query(0x0100, 1), 53000, 0x4000);
        DnsPacket.put16(packet, 2, packet.length + 20);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet, packet.length));
    }

    @Test public void rejectsUdpLengthLargerThanIpv4Payload() {
        byte[] packet = packet(query(0x0100, 1), 53000, 0x4000);
        DnsPacket.put16(packet, 24, packet.length);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet, packet.length));
    }

    @Test public void rejectsUdpLengthSmallerThanIpv4Payload() {
        byte[] packet = packet(query(0x0100, 1), 53000, 0x4000);
        byte[] padded = Arrays.copyOf(packet, packet.length + 8);
        DnsPacket.put16(padded, 2, padded.length);
        // Leave the UDP length at the original datagram size. A TUN IPv4 packet
        // with extra unexplained IP payload is malformed/ambiguous and must not
        // be partially parsed as DNS.
        assertNull(DnsPacket.parseIpv4UdpQuery(padded, padded.length));
    }

    @Test public void rejectsDnsResponseMasqueradingAsTunQuery() {
        byte[] packet = packet(query(0x8100, 1), 53000, 0x4000);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet, packet.length));
    }

    @Test public void rejectsNonStandardDnsOpcode() {
        byte[] packet = packet(query(0x0900, 1), 53000, 0x4000);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet, packet.length));
    }

    @Test public void rejectsMultipleQuestionPacketToKeepBlockDecisionUnambiguous() {
        byte[] packet = packet(query(0x0100, 2), 53000, 0x4000);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet, packet.length));
    }

    @Test public void rejectsZeroSourcePort() {
        byte[] packet = packet(query(0x0100, 1), 0, 0x4000);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet, packet.length));
    }

    private static byte[] query(int flags, int qdCount) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write16(out, 0x1234);
        write16(out, flags);
        write16(out, qdCount);
        write16(out, 0);
        write16(out, 0);
        write16(out, 0);
        label(out, "ads");
        label(out, "example");
        label(out, "com");
        out.write(0);
        write16(out, 1); // A
        write16(out, 1); // IN
        return out.toByteArray();
    }

    private static byte[] packet(byte[] dns, int sourcePort, int fragmentFlags) {
        int total = 20 + 8 + dns.length;
        byte[] packet = new byte[total];
        packet[0] = 0x45;
        DnsPacket.put16(packet, 2, total);
        DnsPacket.put16(packet, 6, fragmentFlags);
        packet[8] = 64;
        packet[9] = 17;
        packet[12] = 10;
        packet[13] = 0;
        packet[14] = 0;
        packet[15] = 2;
        packet[16] = 10;
        packet[17] = 111;
        packet[18] = (byte)222;
        packet[19] = 1;
        DnsPacket.put16(packet, 20, sourcePort);
        DnsPacket.put16(packet, 22, DnsPacket.DNS_PORT);
        DnsPacket.put16(packet, 24, 8 + dns.length);
        System.arraycopy(dns, 0, packet, 28, dns.length);
        return packet;
    }

    private static void label(ByteArrayOutputStream out, String label) {
        byte[] bytes = label.getBytes(StandardCharsets.US_ASCII);
        out.write(bytes.length);
        out.write(bytes, 0, bytes.length);
    }

    private static void write16(ByteArrayOutputStream out, int value) {
        out.write((value >>> 8) & 0xFF);
        out.write(value & 0xFF);
    }
}
