"""Read-only audit of the actual published protection feeds, using the current UTC time."""
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
ROLES = {'live-shield', 'live-matrix', 'titan'}
MAX_AGE = timedelta(days=45)
WARN_AGE = timedelta(days=30)
FUTURE_SKEW = timedelta(days=1)
MAX_BYTES = 2 * 1024 * 1024


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('timestamp must be a string')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('timestamp must include a timezone')
    return parsed.astimezone(timezone.utc)


def endpoint(ref, path):
    if not isinstance(ref, str) or not re.fullmatch(r'[A-Za-z0-9._/-]{1,120}', ref) or '..' in ref or ref.startswith('/'):
        raise ValueError('invalid feed ref')
    if not isinstance(path, str) or not re.fullmatch(r'browser-intelligence/[A-Za-z0-9_./-]+\.json', path) or '..' in path:
        raise ValueError('invalid feed path')
    return 'https://raw.githubusercontent.com/Swir/xADKiller/' + quote(ref, safe='') + '/' + quote(path, safe='/')


def targets(legacy, parallel):
    if legacy.get('schema') != 1 or legacy.get('algorithm') != 'git-blob-sha1':
        raise ValueError('invalid production checksum manifest')
    if parallel.get('schema') != 1 or parallel.get('remote_executable_code') is not False:
        raise ValueError('invalid parallel channel manifest')
    result = []
    for label, manifest in [('production-v1', legacy), ('parallel-v2', parallel)]:
        entries = manifest.get('feeds', [])
        if len(entries) != 3 or {e.get('id') for e in entries} != ROLES:
            raise ValueError(f'{label} must contain each of the three feed roles exactly once')
        for entry in entries:
            ref = entry.get('source_ref') if label == 'production-v1' else manifest.get('published_ref')
            result.append(dict(entry, label=label, expected_schema=1 if label == 'production-v1' else 2,
                               url=endpoint(ref, entry.get('path'))))
    return result


def fetch_bytes(url):
    request = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'xADKiller-freshness-audit'})
    with urlopen(request, timeout=15) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError('feed exceeds the runtime size limit')
    return body


def inspect(entry, body, now):
    errors, warnings = [], []
    data = json.loads(body)
    if data.get('schema') != entry['expected_schema']:
        errors.append('schema differs from the approved channel')
    digest = hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest()
    if digest != entry.get('git_blob_sha1'):
        errors.append('published payload differs from approved checksum')
    if data.get('feed_version') != entry.get('feed_version'):
        errors.append('version differs from the approved manifest')
    if 'updated_at' in entry and data.get('updated_at') != entry['updated_at']:
        errors.append('updated_at differs from the approved manifest')
    updated = timestamp(data.get('updated_at'))
    age = now - updated
    if updated > now + FUTURE_SKEW:
        errors.append('updated_at is in the future beyond runtime tolerance')
    if age > MAX_AGE:
        errors.append('feed is older than the runtime 45-day limit')
    elif age >= WARN_AGE:
        warnings.append('feed is at least 30 days old; review before the runtime limit')
    expiry = data.get('expires_at')
    if entry['expected_schema'] == 2 or expiry is not None:
        expires = timestamp(expiry)
        if entry.get('expires_at') != expiry:
            errors.append('expiry differs from the approved manifest')
        if expires <= updated:
            errors.append('expiry must be after updated_at')
        if expires - updated > timedelta(days=60):
            errors.append('v2 lifetime exceeds the runtime 60-day limit')
        if expires <= now:
            errors.append('feed has expired')
        elif expires - now <= timedelta(days=7):
            warnings.append('feed expires within seven days')
    return dict(channel=entry['label'], role=entry['id'], url=entry['url'],
                version=data.get('feed_version'), updated_at=data.get('updated_at'), expires_at=expiry,
                age_days=round(age.total_seconds()/86400, 2), errors=errors, warnings=warnings)


def audit(entries, now, fetcher=fetch_bytes):
    results = []
    for entry in entries:
        try:
            result = inspect(entry, fetcher(entry['url']), now)
        except Exception as exc:
            result = dict(channel=entry['label'], role=entry['id'], url=entry['url'],
                          errors=[f'feed could not be verified: {type(exc).__name__}: {exc}'], warnings=[])
        results.append(result)
    return results


def main():
    now = datetime.now(timezone.utc)
    reports = ROOT / 'feed-audit-report'
    reports.mkdir(exist_ok=True)
    try:
        legacy = json.loads((ROOT/'browser-intelligence/feed-checksums.json').read_text(encoding='utf-8'))
        parallel = json.loads((ROOT/'browser-intelligence/feed-v2-production-channel.json').read_text(encoding='utf-8'))
        results = audit(targets(legacy, parallel), now)
    except Exception as exc:
        results = [dict(channel='configuration', role='manifest', url='', errors=[str(exc)], warnings=[])]
    failures = sum(bool(r['errors']) for r in results)
    report = dict(checked_at=now.isoformat(), failed_feeds=failures, feeds=results)
    (reports/'freshness.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    lines = ['# Protection-feed freshness', '', f'Checked at: {now.isoformat()}', '',
             'This checks published data age and integrity; it does not update rules or prove blocking effectiveness.', '']
    for r in results:
        status = 'FAIL' if r['errors'] else ('WARN' if r['warnings'] else 'PASS')
        line = f"- {status}: {r['channel']} / {r['role']} — {r.get('version', 'unavailable')}, age {r.get('age_days', '?')} days"
        lines.append(line)
        lines.extend('  - '+message for message in r['errors']+r['warnings'])
        print(line)
        for message in r['errors']+r['warnings']:
            print('  '+message)
    summary = '\n'.join(lines)+'\n'
    (reports/'freshness.md').write_text(summary, encoding='utf-8')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as stream:
            stream.write(summary)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
