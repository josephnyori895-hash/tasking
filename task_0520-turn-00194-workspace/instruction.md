# The pause and resume flow leaves the puzzle in a bad state

## What you see

Playing a level normally is fine, but the moment you pause and come back, things fall apart. If you'd already moved a screw before opening the pause menu, the undo control in the top bar is greyed out and unresponsive when you resume, as though the move you just made had never been played — there's no way to take it back. The countdown in the top bar also doesn't match the time you actually had left when you paused, so the pressure you're under afterwards feels wrong.

On top of that, resuming throws the big level-intro title card back up over the playfield, blanketing the planks and screws all over again in the middle of a game you've already started. You're left waiting for an announcement you already saw before you can see the board.

## What correct looks like

Resuming should feel like simply un-freezing the game: you land straight back on the same board you left, the countdown picks up exactly where it stopped, and any move you made before pausing is still there to undo. The big level-intro announcement belongs to the moment a level begins and shouldn't reappear once you're playing.

The broken app currently looks like this:

<img src="/app/problem_assets/broken.png" alt="current (broken) app" width="900" />

The expected app should look like this:

<img src="/app/problem_assets/target.png" alt="expected app" width="900" />
