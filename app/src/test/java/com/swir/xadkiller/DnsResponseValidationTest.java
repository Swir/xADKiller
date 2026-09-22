package com.swir.xadkiller;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import org.junit.Test;

public class DnsResponseValidationTest {
    @Test public void acceptsMatchingStandardResponse() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8180, 1, 1);
        assertTrue(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void acceptsWellFormedCompressedAAnswer() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = withSingleAnswer(
                dns("ads.example.com", 0x1234, 0x8180, 1, 1),
                1, 1, 60, 4, new byte[]{1, 2, 3, 4});
        assertTrue(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsTransactionIdMismatch() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1235, 0x8180, 1, 1);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsQueryShapedPacketFromUpstream() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsDnsResponseMarkedTruncated() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8380, 1, 1); // QR + TC + RD + RA
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsQuestionNameMismatch() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("safe.example.com", 0x1234, 0x8180, 1, 1);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsQuestionTypeMismatch() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8180, 28, 1);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsQuestionClassMismatch() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8180, 1, 3);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsTruncatedResponseLength() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8180, 1, 1);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, 16));
    }

    @Test public void acceptsValidResponseInsideLargerReceiveBuffer() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8180, 1, 1);
        byte[] receiveBuffer = Arrays.copyOf(response, response.length + 256);
        assertTrue(DnsPacket.isValidUpstreamResponse(query, receiveBuffer, response.length));
    }

    @Test public void rejectsClaimedAnswerThatIsMissing() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8180, 1, 1);
        DnsPacket.put16(response, 6, 1);
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsResourceRecordWithTruncatedRdata() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = withSingleAnswer(
                dns("ads.example.com", 0x1234, 0x8180, 1, 1),
                1, 1, 60, 4, new byte[]{1, 2, 3});
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsUndeclaredTrailingDnsBytes() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] response = dns("ads.example.com", 0x1234, 0x8180, 1, 1);
        response = Arrays.copyOf(response, response.length + 1);
        response[response.length - 1] = 0x55;
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    @Test public void rejectsForwardCompressionPointerInResourceOwner() {
        byte[] query = dns("ads.example.com", 0x1234, 0x0100, 1, 1);
        byte[] base = dns("ads.example.com", 0x1234, 0x8180, 1, 1);
        DnsPacket.put16(base, 6, 1);
        byte[] response = Arrays.copyOf(base, base.length + 12);
        int p = base.length;
        response[p] = (byte)0xC0;
        response[p + 1] = (byte)(p + 4); // invalid forward pointer
        DnsPacket.put16(response, p + 2, 1);
        DnsPacket.put16(response, p + 4, 1);
        // TTL=0, RDLENGTH=0 are already zero-filled.
        assertFalse(DnsPacket.isValidUpstreamResponse(query, response, response.length));
    }

    private static byte[] withSingleAnswer(byte[] base, int type, int clazz, int ttl, int declaredRdLength, byte[] rdata) {
        DnsPacket.put16(base, 6, 1);
        byte[] data = rdata == null ? new byte[0] : rdata;
        byte[] out = Arrays.copyOf(base, base.length + 12 + data.length);
        int p = base.length;
        out[p] = (byte)0xC0;
        out[p + 1] = 0x0C;
        DnsPacket.put16(out, p + 2, type);
        DnsPacket.put16(out, p + 4, clazz);
        out[p + 6] = (byte)((ttl >>> 24) & 0xFF);
        out[p + 7] = (byte)((ttl >>> 16) & 0xFF);
        out[p + 8] = (byte)((ttl >>> 8) & 0xFF);
        out[p + 9] = (byte)(ttl & 0xFF);
        DnsPacket.put16(out, p + 10, declaredRdLength);
        System.arraycopy(data, 0, out, p + 12, data.length);
        return out;
    }

    private static byte[] dns(String host, int id, int flags, int qtype, int qclass) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write16(out, id);
        write16(out, flags);
        write16(out, 1);
        write16(out, 0);
        write16(out, 0);
        write16(out, 0);
        for (String label : host.split("\\.")) label(out, label);
        out.write(0);
        write16(out, qtype);
        write16(out, qclass);
        return out.toByteArray();
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