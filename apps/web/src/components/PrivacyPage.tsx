interface PrivacyPageProps {
  readonly onBack: () => void;
}

export function PrivacyPage({ onBack }: PrivacyPageProps) {
  return (
    <section className="history-page" data-testid="privacy-page" aria-label="Privacy">
      <div className="history-bar">
        <button type="button" className="history-back" data-testid="privacy-back" onClick={onBack}>
          Match
        </button>
        <h1 className="history-title">Privacy</h1>
      </div>
      <div className="history-scroll privacy-copy">
        <p>This note describes the app. It is not legal advice.</p>
        <p>
          On this device the app stores the score, team names, and the list of matches in local storage.
          That data stays in this browser. There is no account and no password in this version.
        </p>
        <p>
          Connect players can share the open match with a QR code. Anyone who scans that code can see the
          score and change the games, until the code expires or the match already has 4 players. The code
          is not an account. Do not show it to people who should not score.
        </p>
        <p>
          A shared match is processed by Cloudflare (Workers and Durable Objects) so the phones can stay in
          sync. The app does not ask for your name, email, or location. There are no analytics and no
          advertising scripts.
        </p>
        <p>
          A live match stops taking scores one day after the last change. Nobody can change the games after that.
        </p>
        <p>
          The match stays on the server as history for two years, then it is deleted automatically.
        </p>
        <p>
          Login, hiding a match from a shared history, and deleting a match for everyone are not in this
          version. Deleting a finished match here removes it from this device only.
        </p>
        <p>Questions: Patrick Stubner, via the GitHub repository patrickstubner/PadelCounterV2.</p>
      </div>
    </section>
  );
}
