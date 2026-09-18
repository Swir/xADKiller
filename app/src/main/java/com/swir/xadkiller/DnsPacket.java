package com.swir.xadkiller;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

final class DnsPacket {
    static final int DNS_PORT = 53;
    private static final int MAX_RESPONSE_RR_COUNT = 512;

    static final class Query {
        final byte[] dnsPayload;
        final String host;
        final int sourcePort;
        final byte[] sourceIp;
        final byte[] destIp;

        Query(byte[] dnsPayload, String host, int sourcePort, byte[] sourceIp, byte[] destIp) {
            this.dnsPayload = dnsPayload;
            this.host = host;
            this.sourcePort = sourcePort;
            this.sourceIp = sourceIp;
            this.destIp = destIp;
        }
    }

    private DnsPacket() {}

    static Query parseIpv4UdpQuery(byte[] packet, int length) {
        if (packet == null || length < 40 || length > packet.length) return null;
        int version = (packet[0] >> 4) & 0x0F;
        if (version != 4) return null;
        int ihl = (packet[0] & 0x0F) * 4;
        if (ihl < 20 || length < ihl + 8 + 12) return null;

        int ipTotalLength = u16(packet, 2);
        if (ipTotalLength < ihl + 8 + 12 || ipTotalLength > length) return null;

        int protocol = packet[9] & 0xFF;
        if (protocol != 17) return null;

        // Reject every fragmented DNS datagram, including the first fragment with MF=1.
        // The local filter intentionally handles only complete UDP DNS messages.
        int frag = ((packet[6] & 0xFF) << 8) | (packet[7] & 0xFF);
        if ((frag & 0x3FFF) != 0) return null;

        int srcPort = u16(packet, ihl);
        int dstPort = u16(packet, ihl + 2);
        if (srcPort == 0 || dstPort != DNS_PORT) return null;

        int udpLen = u16(packet, ihl + 4);
        // For packets read from the TUN interface there is no Ethernet padding: the
        // IPv4 payload must be exactly one complete UDP datagram. Accepting a shorter
        // UDP length would make the DNS parser ignore unexplained trailing IP payload,
        // creating two different interpretations of the same packet.
        if (udpLen < 20 || udpLen != ipTotalLength - ihl || ihl + udpLen > length) return null;
        int dnsLen = udpLen - 8;
        if (dnsLen < 12) return null;

        byte[] dns = Arrays.copyOfRange(packet, ihl + 8, ihl + 8 + dnsLen);
        int flags = u16(dns, 2);
        int qdCount = u16(dns, 4);
        // Only standard single-question queries are supported. Reject response packets,
        // exotic opcodes and multi-question packets so the blocking decision is never
        // based on a different question than the one actually forwarded.
        if ((flags & 0x8000) != 0 || (flags & 0x7800) != 0 || qdCount != 1) return null;

        String host = extractQueryName(dns);
        if (host == null || host.isEmpty() || host.length() > 253) return null;

        byte[] srcIp = Arrays.copyOfRange(packet, 12, 16);
        byte[] dstIp = Arrays.copyOfRange(packet, 16, 20);
        return new Query(dns, host, srcPort, srcIp, dstIp);
    }

    static String extractQueryName(byte[] dns) {
        if (dns == null || dns.length < 17) return null;
        int qdCount = u16(dns, 4);
        if (qdCount < 1) return null;

        StringBuilder out = new StringBuilder();
        int pos = 12;
        int guard = 0;
        while (pos < dns.length && guard++ < 128) {
            int len = dns[pos] & 0xFF;
            if (len == 0) { pos++; break; }
            if ((len & 0xC0) == 0xC0) {
                if (pos + 1 >= dns.length) return null;
                int ptr = ((len & 0x3F) << 8) | (dns[pos + 1] & 0xFF);
                String suffix = readNameAt(dns, ptr, 0);
                if (suffix == null) return null;
                if (out.length() > 0 && !suffix.isEmpty()) out.append('.');
                out.append(suffix);
                pos += 2;
                break;
            }
            if (len > 63 || pos + 1 + len > dns.length) return null;
            if (out.length() > 0) out.append('.');
            out.append(new String(dns, pos + 1, len, StandardCharsets.US_ASCII));
            pos += 1 + len;
        }
        if (pos + 4 > dns.length) return null;
        return out.toString().toLowerCase();
    }

    private static String readNameAt(byte[] dns, int pos, int depth) {
        if (depth > 10 || pos < 0 || pos >= dns.length) return null;
        StringBuilder out = new StringBuilder();
        int guard = 0;
        while (pos < dns.length && guard++ < 128) {
            int len = dns[pos] & 0xFF;
            if (len == 0) return out.toString();
            if ((len & 0xC0) == 0xC0) {
                if (pos + 1 >= dns.length) return null;
                int ptr = ((len & 0x3F) << 8) | (dns[pos + 1] & 0xFF);
                String suffix = readNameAt(dns, ptr, depth + 1);
                if (suffix == null) return null;
                if (out.length() > 0 && !suffix.isEmpty()) out.append('.');
                out.append(suffix);
                return out.toString();
            }
            if (len > 63 || pos + 1 + len > dns.length) return null;
            if (out.length() > 0) out.append('.');
            out.append(new String(dns, pos + 1, len, StandardCharsets.US_ASCII));
            pos += 1 + len;
        }
        return null;
    }

    /**
     * Accept an upstream DNS reply only when it is a real standard response to the exact
     * single question we forwarded. This is intentionally stricter than checking only the
     * transaction id: mismatched question names/types/classes, query-shaped packets and
     * structurally incomplete answer/authority/additional sections are rejected before
     * they can be written back into the VPN tunnel.
     */
    static boolean isValidUpstreamResponse(byte[] query, byte[] response, int responseLength) {
        if (query == null || response == null || query.length < 17 || responseLength < 17 || responseLength > response.length) {
            return false;
        }
        if (query[0] != response[0] || query[1] != response[1]) return false;

        int queryFlags = u16(query, 2);
        int responseFlags = u16(response, 2);
        if ((queryFlags & 0x8000) != 0 || (queryFlags & 0x7800) != 0) return false;
        if ((responseFlags & 0x8000) == 0 || (responseFlags & 0x7800) != 0) return false;
        // A truncated UDP reply is not a complete answer. Passing TC=1 back into the
        // local DNS-only VPN can trigger retries that this UDP tunnel does not service
        // and can create unreliable fallback behavior. Treat it as an upstream failure
        // so the resolver pool can try another server instead.
        if ((responseFlags & 0x0200) != 0) return false;
        if (u16(query, 4) != 1 || u16(response, 4) != 1) return false;

        byte[] trimmed = responseLength == response.length ? response : Arrays.copyOf(response, responseLength);
        String queryName = extractQueryName(query);
        String responseName = extractQueryName(trimmed);
        if (queryName == null || responseName == null || !queryName.equals(responseName)) return false;

        int queryEnd = questionEnd(query);
        int responseEnd = questionEnd(trimmed);
        if (queryEnd < 4 || responseEnd < 4) return false;
        if (u16(query, queryEnd - 4) != u16(trimmed, responseEnd - 4)
                || u16(query, queryEnd - 2) != u16(trimmed, responseEnd - 2)) {
            return false;
        }
        return hasWellFormedResponseSections(trimmed, responseEnd);
    }

    /**
     * Validate the framing of every declared resource record without interpreting its
     * payload. A response that claims records which are not fully present, uses an
     * impossible/forward owner-name pointer, carries an excessive record count, or leaves
     * undeclared trailing bytes is treated as malformed. This keeps parser work bounded
     * and prevents ambiguous partial replies from entering the local tunnel.
     */
    private static boolean hasWellFormedResponseSections(byte[] dns, int pos) {
        if (dns == null || pos < 12 || pos > dns.length) return false;
        long total = (long)u16(dns, 6) + u16(dns, 8) + u16(dns, 10);
        if (total > MAX_RESPONSE_RR_COUNT) return false;

        for (long i = 0; i < total; i++) {
            int next = skipResourceName(dns, pos);
            if (next < 0 || next + 10 > dns.length) return false;
            int rdLength = u16(dns, next + 8);
            pos = next + 10;
            if (rdLength > dns.length - pos) return false;
            pos += rdLength;
        }
        return pos == dns.length;
    }

    /** Skip an RR owner name. Compression pointers must point backwards into this message. */
    private static int skipResourceName(byte[] dns, int pos) {
        int guard = 0;
        while (pos < dns.length && guard++ < 128) {
            int len = dns[pos] & 0xFF;
            if (len == 0) return pos + 1;
            if ((len & 0xC0) == 0xC0) {
                if (pos + 1 >= dns.length) return -1;
                int pointer = ((len & 0x3F) << 8) | (dns[pos + 1] & 0xFF);
                if (pointer < 12 || pointer >= pos || pointer >= dns.length) return -1;
                return pos + 2;
            }
            if ((len & 0xC0) != 0 || len > 63 || pos + 1 + len > dns.length) return -1;
            pos += 1 + len;
        }
        return -1;
    }

    static byte[] nxdomain(byte[] query) { return errorResponse(query, 3); }
    static byte[] servfail(byte[] query) { return errorResponse(query, 2); }

    private static byte[] errorResponse(byte[] query, int rcode) {
        int qEnd = questionEnd(query);
        if (qEnd <= 12) return null;
        byte[] out = Arrays.copyOf(query, qEnd);
        int flags = u16(query, 2);
        int responseFlags = (flags & 0x7910) | 0x8080 | (rcode & 0x0F);
        put16(out, 2, responseFlags);
        put16(out, 6, 0);
        put16(out, 8, 0);
        put16(out, 10, 0);
        return out;
    }

    private static int questionEnd(byte[] dns) {
        if (dns == null || dns.length < 17) return -1;
        int pos = 12;
        int guard = 0;
        while (pos < dns.length && guard++ < 128) {
            int len = dns[pos] & 0xFF;
            if (len == 0) { pos++; break; }
            if ((len & 0xC0) == 0xC0) { pos += 2; break; }
            if (len > 63 || pos + 1 + len > dns.length) return -1;
            pos += 1 + len;
        }
        if (pos + 4 > dns.length) return -1;
        return pos + 4;
    }

    static byte[] buildIpv4UdpResponse(Query query, byte[] dnsResponse) {
        if (query == null || dnsResponse == null) return null;
        int totalLen = 20 + 8 + dnsResponse.length;
        if (totalLen > 65535) return null;
        byte[] out = new byte[totalLen];
        out[0] = 0x45;
        out[1] = 0;
        put16(out, 2, totalLen);
        put16(out, 4, 0);
        put16(out, 6, 0x4000);
        out[8] = 64;
        out[9] = 17;
        System.arraycopy(query.destIp, 0, out, 12, 4);
        System.arraycopy(query.sourceIp, 0, out, 16, 4);
        put16(out, 10, 0);
        put16(out, 10, ipv4Checksum(out, 0, 20));

        int udp = 20;
        put16(out, udp, DNS_PORT);
        put16(out, udp + 2, query.sourcePort);
        put16(out, udp + 4, 8 + dnsResponse.length);
        put16(out, udp + 6, 0);
        System.arraycopy(dnsResponse, 0, out, udp + 8, dnsResponse.length);
        return out;
    }

    private static int ipv4Checksum(byte[] data, int off, int len) {
        long sum = 0;
        int i = off;
        while (i + 1 < off + len) {
            sum += ((data[i] & 0xFF) << 8) | (data[i + 1] & 0xFF);
            sum = (sum & 0xFFFF) + (sum >> 16);
            i += 2;
        }
        if (i < off + len) {
            sum += (data[i] & 0xFF) << 8;
            sum = (sum & 0xFFFF) + (sum >> 16);
        }
        while ((sum >> 16) != 0) sum = (sum & 0xFFFF) + (sum >> 16);
        return (int) (~sum) & 0xFFFF;
    }

    static int u16(byte[] b, int off) { return ((b[off] & 0xFF) << 8) | (b[off + 1] & 0xFF); }
    static void put16(byte[] b, int off, int v) { b[off] = (byte) ((v >>> 8) & 0xFF); b[off + 1] = (byte) (v & 0xFF); }
}