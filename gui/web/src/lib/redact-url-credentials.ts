// gui/web/src/lib/redact-url-credentials.ts
//
// Strip user:pass / token-style credentials from URLs embedded in arbitrary
// text. Used by JobStreamModal so that streamed CLI output (e.g. `git clone`
// progress lines) cannot leak credentials a user typed into the
// Install-from-URL modal.
//
// The regex matches a scheme (https/http/ssh/git) followed by `://`, then
// any non-`@`/non-whitespace/non-`/` userinfo, then `@`. The matched
// userinfo is replaced with `***`. Only URLs with an explicit scheme are
// recognized — bare `token@host` strings are left alone (could be log noise).
//
// Security-audit MEDIUM-1.

const URL_WITH_CREDS = /\b(https?|ssh|git):\/\/[^@\s/]+@/gi;

export function redactUrlCredentials(text: string): string {
  return text.replace(URL_WITH_CREDS, (match) => {
    const schemeEnd = match.indexOf("://");
    const scheme = match.slice(0, schemeEnd);
    return `${scheme}://***@`;
  });
}
