package com.swir.xadkiller;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

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

    @Test public void acceptsSingleWellFormedEdnsOptRecord() {
        byte[] dns = withAdditional(query(0x0100, 1), 41, new byte[] { 0, 10, 0, 2, 1, 2 });
        DnsPacket.Query parsed = DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length);
        assertNotNull(parsed);
        assertEquals("ads.example.com", parsed.host);
    }

    @Test public void acceptsEdnsDnssecOkFlag() {
        byte[] base = query(0x0100, 1);
        byte[] dns = withAdditional(base, 41, new byte[0]);
        int opt = base.length;
        DnsPacket.put16(dns, opt + 7, 0x8000);
        assertNotNull(DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length));
    }

    @Test public void clampsOversizedEdnsUdpPayloadForUpstreamStability() {
        byte[] base = query(0x0100, 1);
        byte[] dns = withAdditional(base, 41, new byte[0]);
        int opt = base.length;
        DnsPacket.put16(dns, opt + 3, 4096);
        DnsPacket.Query parsed = DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length);
        assertNotNull(parsed);
        assertEquals(4096, DnsPacket.u16(dns, opt + 3));
        assertEquals(1232, DnsPacket.u16(parsed.dnsPayload, opt + 3));
    }

    @Test public void preservesSmallerEdnsUdpPayload() {
        byte[] base = query(0x0100, 1);
        byte[] dns = withAdditional(base, 41, new byte[0]);
        int opt = base.length;
        DnsPacket.put16(dns, opt + 3, 512);
        DnsPacket.Query parsed = DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length);
        assertNotNull(parsed);
        assertEquals(512, DnsPacket.u16(parsed.dnsPayload, opt + 3));
        assertArrayEquals(dns, parsed.dnsPayload);
    }

    @Test public void stripsEcsAndCookieButPreservesOtherEdnsOptionsAndDoFlag() {
        byte[] base = query(0x0100, 1);
        byte[] ecs = ednsOption(8, new byte[] { 0, 1, 24, 0, (byte)192, 0, 2 });
        byte[] unknown = ednsOption(65001, new byte[] { 3, 4 });
        byte[] cookie = ednsOption(10, new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 });
        byte[] dns = withAdditional(base, 41, concat(ecs, unknown, cookie));
        int opt = base.length;
        DnsPacket.put16(dns, opt + 7, 0x8000);

        DnsPacket.Query parsed = DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length);
        assertNotNull(parsed);
        assertEquals(1, DnsPacket.u16(parsed.dnsPayload, 10));
        assertEquals(0x8000, DnsPacket.u16(parsed.dnsPayload, opt + 7));
        assertEquals(unknown.length, DnsPacket.u16(parsed.dnsPayload, opt + 9));
        assertEquals(65001, DnsPacket.u16(parsed.dnsPayload, opt + 11));
        assertEquals(2, DnsPacket.u16(parsed.dnsPayload, opt + 13));
        assertEquals(3, parsed.dnsPayload[opt + 15] & 0xFF);
        assertEquals(4, parsed.dnsPayload[opt + 16] & 0xFF);
        assertEquals(opt + 11 + unknown.length, parsed.dnsPayload.length);
    }

    @Test public void keepsEmptyOptRecordAfterAllPrivacyOptionsAreRemoved() {
        byte[] base = query(0x0100, 1);
        byte[] dns = withAdditional(base, 41, concat(
                ednsOption(8, new byte[] { 0, 1, 0, 0 }),
                ednsOption(10, new byte[] { 9, 8, 7, 6, 5, 4, 3, 2 })));
        int opt = base.length;

        DnsPacket.Query parsed = DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length);
        assertNotNull(parsed);
        assertEquals(1, DnsPacket.u16(parsed.dnsPayload, 10));
        assertEquals(41, DnsPacket.u16(parsed.dnsPayload, opt + 1));
        assertEquals(0, DnsPacket.u16(parsed.dnsPayload, opt + 9));
        assertEquals(opt + 11, parsed.dnsPayload.length);
    }

    @Test public void leavesNonPrivacyEdnsOptionsByteExact() {
        byte[] base = query(0x0100, 1);
        byte[] dns = withAdditional(base, 41, concat(
                ednsOption(12, new byte[] { 0, 0, 0, 0 }),
                ednsOption(65001, new byte[] { 1, 2, 3 })));
        DnsPacket.Query parsed = DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length);
        assertNotNull(parsed);
        assertArrayEquals(dns, parsed.dnsPayload);
    }

    @Test public void rejectsEdnsExtendedRcodeInQuery() {
        byte[] base = query(0x0100, 1);
        byte[] dns = withAdditional(base, 41, new byte[0]);
        int opt = base.length;
        dns[opt + 5] = 1;
        assertNull(DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length));
    }

    @Test public void rejectsUnsupportedEdnsVersion() {
        byte[] base = query(0x0100, 1);
        byte[] dns = withAdditional(base, 41, new byte[0]);
        int opt = base.length;
        dns[opt + 6] = 1;
        assertNull(DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length));
    }

    @Test public void rejectsReservedEdnsZFlags() {
        byte[] base = query(0x0100, 1);
        byte[] dns = withAdditional(base, 41, new byte[0]);
        int opt = base.length;
        DnsPacket.put16(dns, opt + 7, 0x0001);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length));
    }

    @Test public void rejectsTruncatedEdnsOptionHeader() {
        byte[] dns = withAdditional(query(0x0100, 1), 41, new byte[] { 0, 10, 0 });
        assertNull(DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length));
    }

    @Test public void rejectsEdnsOptionLengthPastRdata() {
        byte[] dns = withAdditional(query(0x0100, 1), 41, new byte[] { 0, 10, 0, 4, 1, 2 });
        assertNull(DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length));
    }

    @Test public void rejectsUndeclaredTrailingDnsBytes() {
        byte[] dns = Arrays.copyOf(query(0x0100, 1), query(0x0100, 1).length + 3);
        dns[dns.length - 1] = 7;
        assertNull(DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length));
    }

    @Test public void rejectsAnswerRecordsInsideQueryPacket() {
        byte[] dns = query(0x0100, 1);
        DnsPacket.put16(dns, 6, 1);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length));
    }

    @Test public void rejectsAuthorityRecordsInsideQueryPacket() {
        byte[] dns = query(0x0100, 1);
        DnsPacket.put16(dns, 8, 1);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length));
    }

    @Test public void rejectsMultipleAdditionalRecords() {
        byte[] dns = withAdditional(query(0x0100, 1), 41, new byte[0]);
        DnsPacket.put16(dns, 10, 2);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length));
    }

    @Test public void rejectsNonOptAdditionalRecord() {
        byte[] dns = withAdditional(query(0x0100, 1), 1, new byte[] { 1, 2, 3, 4 });
        assertNull(DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length));
    }

    @Test public void rejectsTruncatedEdnsRdata() {
        byte[] dns = withAdditional(query(0x0100, 1), 41, new byte[] { 1, 2 });
        int opt = query(0x0100, 1).length;
        DnsPacket.put16(dns, opt + 9, 8);
        assertNull(DnsPacket.parseIpv4UdpQuery(packet(dns, 53000, 0x4000), 20 + 8 + dns.length));
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

    @Test public void acceptsValidNonZeroIncomingUdpChecksum() {
        byte[] packet = packet(query(0x0100, 1), 53000, 0x4000);
        applyUdpChecksum(packet);
        assertTrue(DnsPacket.u16(packet, 26) != 0);
        assertNotNull(DnsPacket.parseIpv4UdpQuery(packet, packet.length));
    }

    @Test public void rejectsCorruptedIncomingUdpDatagramWhenChecksumIsPresent() {
        byte[] packet = packet(query(0x0100, 1), 53000, 0x4000);
        applyUdpChecksum(packet);
        packet[28] ^= 0x01;
        assertNull(DnsPacket.parseIpv4UdpQuery(packet, packet.length));
    }

    @Test public void synthesizedDnsReplyCarriesValidUdpChecksum() {
        byte[] request = packet(query(0x0100, 1), 53000, 0x4000);
        DnsPacket.Query parsed = DnsPacket.parseIpv4UdpQuery(request, request.length);
        assertNotNull(parsed);
        byte[] dnsResponse = DnsPacket.nxdomain(parsed.dnsPayload);
        assertNotNull(dnsResponse);
        byte[] reply = DnsPacket.buildIpv4UdpResponse(parsed, dnsResponse);
        assertNotNull(reply);

        int wireChecksum = DnsPacket.u16(reply, 26);
        assertTrue(wireChecksum != 0);
        assertEquals(0xFFFF, udpPseudoHeaderSum(reply));

        byte[] corrupted = Arrays.copyOf(reply, reply.length);
        corrupted[corrupted.length - 1] ^= 0x01;
        assertTrue(udpPseudoHeaderSum(corrupted) != 0xFFFF);
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
        write16(out, 1);
        write16(out, 1);
        return out.toByteArray();
    }

    private static byte[] withAdditional(byte[] query, int type, byte[] rdata) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] base = Arrays.copyOf(query, query.length);
        DnsPacket.put16(base, 10, 1);
        out.write(base, 0, base.length);
        out.write(0);
        write16(out, type);
        write16(out, 1232);
        write16(out, 0);
        write16(out, 0);
        write16(out, rdata.length);
        out.write(rdata, 0, rdata.length);
        return out.toByteArray();
    }

    private static byte[] ednsOption(int code, byte[] data) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write16(out, code);
        write16(out, data.length);
        out.write(data, 0, data.length);
        return out.toByteArray();
    }

    private static byte[] concat(byte[]... values) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] value : values) out.write(value, 0, value.length);
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

    private static void applyUdpChecksum(byte[] packet) {
        DnsPacket.put16(packet, 26, 0);
        int checksum = (~udpPseudoHeaderSum(packet)) & 0xFFFF;
        DnsPacket.put16(packet, 26, checksum == 0 ? 0xFFFF : checksum);
        assertEquals(0xFFFF, udpPseudoHeaderSum(packet));
    }

    private static int udpPseudoHeaderSum(byte[] packet) {
        long sum = 0;
        for (int i = 12; i < 20; i += 2) {
            sum += ((packet[i] & 0xFF) << 8) | (packet[i + 1] & 0xFF);
        }
        int udpLength = DnsPacket.u16(packet, 24);
        sum += 17;
        sum += udpLength;
        int end = 20 + udpLength;
        for (int i = 20; i + 1 < end; i += 2) {
            sum += ((packet[i] & 0xFF) << 8) | (packet[i + 1] & 0xFF);
        }
        if ((udpLength & 1) != 0) sum += (packet[end - 1] & 0xFF) << 8;
        while ((sum >> 16) != 0) sum = (sum & 0xFFFF) + (sum >> 16);
        return (int)sum & 0xFFFF;
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
