// Google auth is only needed when LLM_PROVIDER=vertex. It is loaded on demand,
// so the default Claude build does not need any Google package installed.
export async function loadGoogleAuth(): Promise<any> {
  const pkg = 'google-auth-library';
  try {
    const m: any = await import(/* webpackIgnore: true */ pkg);
    return m.GoogleAuth;
  } catch {
    throw new Error('LLM_PROVIDER=vertex needs google-auth-library: run `npm install google-auth-library`');
  }
}
