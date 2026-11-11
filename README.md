# Franchise Tycoon

A stadium-district sim driven by your Sleeper fantasy football league.

## Solo play

Open `dist/franchise-tycoon.html` in a browser. Enter a Sleeper username or play the demo league. Nothing to install.

## League mode

League mode puts every owner in one shared game and posts a weekly table of bonus points for the commissioner to add to fantasy scores in Sleeper. It needs the small server in this folder running somewhere every owner can reach.

### Run it

Needs Node.js 18 or newer. No packages to install.

```bash
npm start
```

Then open `http://localhost:8787`. The setup screen now offers **Start a league season (commissioner)**.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Port to listen on | `8787` |
| `DATA_FILE` | Where league state is saved | `data/leagues.json` |
| `CREATE_KEY` | If set, creating a league requires this key | none |
| `DEMO` | Set to `1` to allow demo leagues with a hand-moved clock | off |

### Put it online

Owners need a public address. Any host that runs a long-lived Node process works. Two things matter:

- **Keep the data file.** Point `DATA_FILE` at storage that survives restarts (a mounted disk or volume). If the file is lost, the league season is lost.
- **Set `CREATE_KEY`** on a public server so strangers cannot create leagues on it.

A `Dockerfile` is included for hosts that deploy from one.

### Deploy to Google Cloud Run

Cloud Run runs the container and scales to zero when nobody is playing. League state lives in a Cloud Storage bucket mounted at `/data`, so it survives restarts. Keep `--max-instances 1`: the server is the only writer of `leagues.json`.

From Google Cloud Shell, in this folder (replace `PROJECT` and choose your own `CREATE_KEY`):

```bash
gcloud config set project PROJECT
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud storage buckets create gs://PROJECT-franchise-tycoon --location=us-central1
gcloud storage buckets add-iam-policy-binding gs://PROJECT-franchise-tycoon --member="serviceAccount:$(gcloud projects describe PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com" --role=roles/storage.objectUser
gcloud run deploy franchise-tycoon --source . --region us-central1 --allow-unauthenticated --max-instances 1 --execution-environment gen2 --set-env-vars CREATE_KEY=your-secret,DATA_FILE=/data/leagues.json --add-volume name=data,type=cloud-storage,bucket=PROJECT-franchise-tycoon --add-volume-mount volume=data,mount-path=/data
```

To ship an update, run the last command again.

### How a season runs

1. The commissioner creates the league season from their Sleeper username, sets the rules, and sends each owner their private link from the Admin tab. A link is that owner's login.
2. Every franchise starts level at the next unplayed week. Past weeks are not replayed.
3. Each week is open for building, ticket prices and promotions until the lock (default Thursday 8:00 PM Eastern). After that nothing can change.
4. When Sleeper finalizes the week, every franchise settles at once and the Bonus tab posts the table.
5. The commissioner adds those points to the following week's scores in Sleeper. The Bonus tab shows that week's matchups with bonuses applied and flags any result the bonus changes.

### Two league formats

The commissioner picks one on the Admin tab and can change it later.

- **Sim standings only.** Fantasy scores are never touched. The season ledger (revenue, costs, profit) is the scoreboard, ranked by season profit or franchise value, and the commissioner can name a prize for the sim champion.
- **Bonus points.** The sim awards a capped, sliding-scale bonus each week. The Admin tab has a score sheet that works out every team's new score, lets the commissioner change any bonus, and copies the list to enter in Sleeper. Sleeper's API is read-only, so entering them is always manual.

### How bonus points are decided

Each owner is compared with an auto-pilot owner who had the same fantasy result that week. The **edge** is how much more the owner's franchise earned than that auto-pilot, as a percentage. Ranking by edge rewards sim decisions and not the fantasy score. The sim always runs on raw Sleeper scores, so bonuses never feed back into it.

**Visiting fans.** On an away week a share of your fanbase travels (more with high hype, a Transit Hub and a win streak). They only get seats the home crowd left empty. The share of the building they fill cuts the bonus the home owner brings into that matchup, up to the commissioner's limit. A full house keeps them out.

**Trades.** Completed Sleeper trades change fan mood in the week they happen: acquiring high scorers lifts hype, the home crowd and jersey sales; trading them away does the opposite. The side that gained star power also pays the other a transfer fee in sim cash, the trade makes the league news, and the city shows it (a welcome banner, or fans protesting outside the stadium).

**Matchup wagers.** Before the first points are scored, challenge your real opponent to a sim-cash bet on the fantasy result. The server settles it from Sleeper.

**Rail links.** Two owners with level 2 Transit Hubs can build a line between their cities for $250k each. Both earn weekly tourism from the other's fans, and twice as many fans travel when they play each other.

Transfer fees, wagers and rail tourism count in the sim standings but never in bonus points.

**Mini-games.** Every building has a short arcade game. Each owner gets three tries per building per week, and the best medal lifts that building by 4%, 7% or 10% on the next game day. Scores are reported by each owner's own browser, so the commissioner can switch the boost off on the Admin tab and leave the games as bragging rights.

**City looks.** Each owner picks two team colours and a setting (Metro, Mountain, Riverside or Beachfront) from Menu → Customize city. Looks never affect the rules.

**Visiting other cities.** On the League tab, tap any franchise to see that owner's city. Tap a building there to play its mini-game as a visitor: for fun only, nothing is recorded for either owner.

Commissioner settings (Admin tab): maximum points per week, the most a visiting crowd can cut a home owner's bonus, who is paid (everyone above last place, top half, or top three), playoff start week, last week of the season, whether bonuses apply in the playoffs, and the lock day and hour.

## Development

See `CLAUDE.md`.
