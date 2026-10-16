# Home View

An Obsidian code block for a home page that talks to you, in plain sentences:

> Good afternoon.
>
> It is now **17:45**.
> Today is Thursday, Oct 15, 2026.
> You have **5h 15min** left for today.
>
> You have **2** remaining items.
> ○ Problem set 5
> ○ Read chapter 3

Beside the text sit two dials: a small analog clock, and a ring showing the
percent of your waking day that is left. Behind it all, the pane takes the colour
of the sky at this hour — navy and stars before dawn, rose at sunrise, blue at
midday, gold before sunset, coral at sunset, violet at dusk — following the real
sun, blended minute by minute.

````
```home-view
```
````

- **Time of day.** Between `wake` and `bed` it counts down to bedtime. After
  `bed` it says you should be sleeping by now (the ring shows a moon). Between
  sunrise and `wake` it congratulates you on getting up early (the ring shows a sun).
- **Items.** Every file in `folder` (and its subfolders), soonest `due date`
  property first. Click a line to open the note; Cmd/Ctrl-click opens it in a new tab.
  When the folder is empty, it says you are all clear.
- **Layout.** On a wide pane: prose on the left, dials and items on the right.
  On a phone or narrow pane everything stacks.
- Updates on every minute, and whenever a note enters, leaves or changes in `folder`.

## Options

Leading `key: value` lines (defaults shown):

````
```home-view
name:
folder: today
wake: 8:00
bed: 23:00
lat:
lon:
sky: on
dev: off
```
````

`name` is added to the greeting. `lat` and `lon` (decimal degrees) are only
used to compute today's sunrise and sunset; without them the
early-riser message never shows. The sky follows the real sun: dawn at sunrise,
gold before sunset, coral at sunset, then dusk and night — whatever your bedtime.
Without a location it assumes sunrise at 6:30 and sunset at 19:30. `sky: off`
keeps the note's normal background. `dev: on` adds a corner time slider to preview
any hour.

## Install

With [BRAT](https://github.com/TfTHacker/obsidian42-brat): add this repository.
Or copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/home-view/`.
