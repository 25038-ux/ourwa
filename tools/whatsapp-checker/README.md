# WhatsApp parent checker

Finds the parents who have **no WhatsApp on any of their numbers**, using your own WhatsApp account on your Windows PC.

For every parent in the list:

1. Its numbers are checked one by one (Téléphone 1, then 2, then 3).
2. As soon as one number has a WhatsApp account, the parent is marked **has WhatsApp** and its other numbers are skipped.
3. If none of its numbers has WhatsApp, the parent goes into the **sans WhatsApp** list. Parents with no number at all ("AUCUN NUMÉRO") are in that list too, with their own reason.

It never sends a message and never adds contacts. It only asks WhatsApp whether each number has an account. That is the same check WhatsApp runs when you type a number to start a new chat.

## Use it (Windows)

1. Extract the zip (right-click → **Extract All**). Don't run it from inside the zip.
2. Put your parents file in the `data` folder (the `.csv` exported from Excel, for example `parents-2026-2027-telephones.csv`). Keep only one file there.
3. Double-click **`START.bat`**.
   - Nothing needs to be installed: the components are included in the zip, and WhatsApp Web opens in **Google Chrome or Microsoft Edge**, whichever is already on the PC.
   - If Node.js 18+ is missing, a private copy is downloaded into the `runtime` folder (no admin rights needed).
   - A browser window opens with WhatsApp Web, and a QR code also appears in the black window. On your phone, open **WhatsApp → Linked devices → Link a device** and scan it. You only do this once: the login is remembered. (Being logged in to the WhatsApp app on your PC is not enough: this is a separate linked device.)
4. Wait. Each parent is printed as it is checked:

   ```
   [  2/442] [NO WhatsApp] Abdellahi (Mohamdy Abdellahi Choueib)  +222 22 22 42 21
   [  3/442] [WhatsApp]    Abderahmane (Saida Abderahmane)  +222 46 40 10 12
   ```

   About 25–35 minutes for 442 parents. The tool waits 2–4 seconds between lookups, and takes a short break every 40, so that WhatsApp does not flag your account.
5. At the end, the Excel file opens by itself.

You can also drag the parents file onto `START.bat` instead of putting it in `data`.

### What START.bat does so that it does not fail

| Possible problem | What happens |
|---|---|
| Node.js missing or older than 18 | Downloads Node.js LTS into `runtime\node` (checksum verified, 3 attempts). |
| Components missing or damaged | Reinstalls them from `package-lock.json` (3 attempts), without running any install script. |
| Browser download failing during installation (the classic puppeteer error "the browser folder exists but the executable is missing") | Cannot happen: no browser is ever downloaded during installation (`.puppeteerrc.cjs`, `PUPPETEER_SKIP_DOWNLOAD`, `--ignore-scripts`). |
| Chrome won't start | Tries Edge, then any other Chrome found. If none starts, downloads Chrome into `.browser` (half-finished downloads are deleted first, 3 attempts). The browser that worked is remembered for next time. |
| Internet cut or WhatsApp disconnects during the run | Waits 20 s, reconnects and continues where it stopped (up to 4 times). |
| Window closed, Ctrl+C, power cut | Every answer is already saved; the next START.bat continues. |

## What you get (folder `results`)

| File | Contents |
|---|---|
| `Parents_sans_WhatsApp.xlsx` | Sheet **Sans WhatsApp**: the parents with no WhatsApp on any number, plus the parents with no number. Also has sheets **Rapport complet** (every parent, its status, and the number that has WhatsApp), **À revérifier** (only if some lookups failed) and **Résumé**. |
| `parents_sans_whatsapp.csv` | The "sans WhatsApp" list, in the same format as your input file. |
| `rapport_complet.csv` | Every parent with its status, in the same format as your input file. |
| `a_reverifier.csv` | Only present if some numbers could not be checked. |
| `journal.txt` | Log of every run. |

Each row keeps its line number from your original file (column `Ligne`), so you can find it again easily.

## Why you can trust the result

- **WhatsApp itself answers.** Each number goes through WhatsApp's own "does this number have an account" lookup. The tool does not read the screen.
- **Self-test before every run.** Your own number must come back as "has WhatsApp", and impossible numbers must come back as "no WhatsApp". If a WhatsApp update breaks the lookup in either direction, the run stops instead of giving you a wrong list.
- **An error is never counted as "no WhatsApp".** A failed lookup is retried 3 times (after 5 s, 15 s and 30 s). If it still fails, the parent goes to **À revérifier**, never to **Sans WhatsApp**. After 3 numbers in a row fail, the run stops (for example when the internet drops or WhatsApp disconnects).
- **Nothing is lost.** Every answer is saved as soon as it arrives (`results/cache-numeros.json`). If you stop the run (Ctrl+C, closed window, power cut), run `START.bat` again: it continues where it stopped and retries only what is missing. A number shared by two parents is checked only once.

## Options

Run from a command prompt in this folder: `START.bat [file] [options]`

| Option | Effect |
|---|---|
| `--dry-run` | Only read the file and show which numbers would be checked (WhatsApp is not used). |
| `--limit 10` | Check only the first 10 parents (quick test). |
| `--fresh` | Forget the saved answers and check every number again (for example next month). |
| `--delay 3-6` | Wait 3 to 6 seconds between lookups instead of 2 to 4. |
| `--headless` | Do not show the browser window. |
| `--pair 22236000000` | Log in with an 8-character code on your phone instead of a QR code. |
| `--browser "C:\path\chrome.exe"` | Try this browser first. |
| `--country 222` | Country code added to numbers written without one (default 222, Mauritania). |
| `--no-open` | Do not open the Excel file at the end. |

## If something goes wrong

| Problem | Fix |
|---|---|
| Stuck on "Loading WhatsApp", or "Self-test failed" | WhatsApp changed its website. Double-click **`UPDATE.bat`**, then `START.bat`. |
| QR code expired or unreadable in the black window | Scan the QR code shown in the browser window instead, or use `--pair` with your number. |
| "Cannot reach web.whatsapp.com" | Check the internet connection (open web.whatsapp.com in your browser), then run `START.bat` again. |
| Excel file not updated | It was open in Excel while the tool wrote it. A copy with the date and time in its name was written next to it. |
| Want to remove the login from this PC | Double-click **`LOGOUT.bat`**, and remove the device on your phone under **Linked devices**. |

## Privacy

The parents file, the results and the WhatsApp login stay on your PC. `.gitignore` keeps them out of git.

## For developers

```
npm install --ignore-scripts  # no browser download: Chrome/Edge on the PC is used
npm test                      # unit tests (no WhatsApp needed)
node src/index.js --dry-run   # parse the file only
node src/check-setup.js       # check that every component loads
```

Built on [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) (`client.getNumberId`). Code: `src/parents.js` reads the file, `src/runner.js` runs the checks (stops at the first WhatsApp number, retries, resume), `src/whatsapp.js` handles the WhatsApp connection and self-test, `src/browser.js` finds (or, as a last resort, downloads) a browser, `src/report.js` writes the outputs.
