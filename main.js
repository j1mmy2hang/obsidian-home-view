const { Plugin, MarkdownRenderChild, TFolder, Keymap, Notice, Platform, setIcon } = require('obsidian');

// Each can be set by a `key: value` line in the block. Without `lat:` / `lon:`
// there is no sunrise, so the early-riser message never shows.
// `sky: off` keeps the note's own background instead of DayTime's sky; the
// emphasised words then take the colour of the hour instead.
// `dev: on` adds a corner panel with a time slider, to preview any hour.
// `reminders: off` leaves Apple Reminders out (they need remindctl, on a Mac).
// `calendar: off` leaves out the next Apple Calendar event (needs icalBuddy, on a Mac).
// `calendars:` limits it to some calendars: names, or IDs where two share a
// name, comma-separated (`icalBuddy calendars` lists both). Blank = all.
// `name: random` greets a different invented person each day.
// `quote: off` hides the daily quote under the greeting.
const DEFAULTS = {
  quote: 'on', name: '', folder: 'today', wake: '8:00', bed: '23:00', lat: '', lon: '',
  sky: 'on', dev: 'off', reminders: 'on', calendar: 'on', calendars: '',
};
const FIRST_NAMES = [
  'Ansel', 'Thaddeus', 'Ignatius', 'Leopold', 'Cassius', 'Ambrose', 'Lucian', 'Barnaby',
  'Florian', 'Evander', 'Caspian', 'Laszlo', 'Osric', 'Percival', 'Remy', 'Wendell',
  'Ellery', 'Horatio', 'Isidore', 'Linus', 'Octavian', 'Quentin', 'Rafferty', 'Ulysses',
  'Valentin', 'Waldo', 'Yannick', 'Zephyr', 'Alaric', 'Bastian', 'Cormac', 'Dashiell',
  'Emeric', 'Gideon', 'Hollis', 'Ivo', 'Kasimir', 'Lorcan', 'Mortimer', 'Orson',
  'Peregrine', 'Rufus', 'Sacha', 'Tycho', 'Lysander', 'Anselm', 'Ciaran', 'Benedikt',
  'Aurelio', 'Bram', 'Crispin', 'Desmond', 'Evren', 'Fitz', 'Halloran', 'Jarek',
  'Kenzo', 'Leander', 'Matthias', 'Nikodem', 'Oberon', 'Piers', 'Rainer', 'Soren',
  'Teodor', 'Wystan', 'Ximo', 'Ignacio', 'Auberon', 'Casimir', 'Dorian', 'Eamon',
];
const LAST_NAMES = [
  'Ashgrove', 'Thistlewood', 'Marchetti', 'Holloway', 'Whitlock', 'Pemberton', 'Ravensworth',
  'Fairweather', 'Quill', 'Larkspur', 'Montague', 'Calloway', 'Drummond', 'Everhart',
  'Galloway', 'Hartwell', 'Kestrel', 'Lockwood', 'Merriweather', 'Nightingale', 'Penhaligon',
  'Rookwood', 'Thornbury', 'Underhill', 'Vale', 'Wexley', 'Yardley', 'Castellane',
  'Delacroix', 'Ferrante', 'Gaspard', 'Moreau', 'Lindqvist', 'Sørensen', 'Aalto', 'Kovač',
  'Novak', 'Valcourt', 'Brightwater', 'Darrow', 'Ellsworth', 'Greaves', 'Ashcombe',
  'Blackthorn', 'Corrigan', 'Dunmore', 'Fenwick', 'Grimaldi', 'Halvorsen', 'Inchbald',
  'Jessop', 'Kilbride', 'Lazarev', 'Mallory', 'Orsini', 'Pryce', 'Quintero', 'Rasmussen',
  'Strand', 'Tallis', 'Vasquez', 'Winterbourne', 'Okafor', 'Achterberg', 'Belmonte',
];
const MIN = 60000;
const DAY = 24 * 60 * MIN;
let inkIds = 0;

// A number in [0, 1) fixed by a string, so a day's picks stay the same all day.
function seeded(key) {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

function dailyName(day) {
  const pick = (list, salt) => list[Math.floor(seeded(day + salt) * list.length)];
  return `${pick(FIRST_NAMES, '/first')} ${pick(LAST_NAMES, '/last')}`;
}

// One quote per day from QUOTE_START, in order, so no day repeats another.
// Append new quotes at the end only: never reorder or delete.
const QUOTE_START = '2026-11-16';
const QUOTES = [
  {"text": "There are worse crimes than burning books. One of them is not reading them.", "by": "Joseph Brodsky"},
  {"text": "A wealth of information creates a poverty of attention.", "by": "Herbert Simon"},
  {"text": "Wrong life cannot be lived rightly.", "by": "Theodor Adorno, Minima Moralia"},
  {"text": "The universe is not only queerer than we suppose, but queerer than we can suppose.", "by": "J. B. S. Haldane, Possible Worlds"},
  {"text": "Interpretation is the revenge of the intellect upon art.", "by": "Susan Sontag, Against Interpretation"},
  {"text": "The aspects of things that are most important for us are hidden because of their simplicity and familiarity.", "by": "Ludwig Wittgenstein, Philosophical Investigations"},
  {"text": "The strong do what they can and the weak suffer what they must.", "by": "Thucydides, History of the Peloponnesian War"},
  {"text": "Time is the substance I am made of. Time is a river which sweeps me along, but I am the river.", "by": "Jorge Luis Borges, A New Refutation of Time"},
  {"text": "Not knowing when the dawn will come, I open every door.", "by": "Emily Dickinson"},
  {"text": "We are what we pretend to be, so we must be careful about what we pretend to be.", "by": "Kurt Vonnegut, Mother Night"},
  {"text": "It requires a very unusual mind to undertake the analysis of the obvious.", "by": "Alfred North Whitehead, Science and the Modern World"},
  {"text": "Out of the crooked timber of humanity, no straight thing was ever made.", "by": "Immanuel Kant"},
  {"text": "What we call the beginning is often the end. And to make an end is to make a beginning.", "by": "T. S. Eliot, Little Gidding"},
  {"text": "人生如逆旅，我亦是行人。", "by": "苏轼，《临江仙·送钱穆父》"},
  {"text": "Photography is truth. The cinema is truth twenty-four times per second.", "by": "Jean-Luc Godard, Le Petit Soldat"},
  {"text": "Angels can fly because they take themselves lightly.", "by": "G. K. Chesterton, Orthodoxy"},
  {"text": "If men define situations as real, they are real in their consequences.", "by": "W. I. Thomas and Dorothy Swaine Thomas"},
  {"text": "Everyone knows the usefulness of the useful, but no one knows the usefulness of the useless.", "by": "Zhuangzi"},
  {"text": "To be rooted is perhaps the most important and least recognized need of the human soul.", "by": "Simone Weil, The Need for Roots"},
  {"text": "Point of view is worth 80 IQ points.", "by": "Alan Kay"},
  {"text": "Nobody ever discovered ugliness through photographs.", "by": "Susan Sontag, On Photography"},
  {"text": "Anxiety is the dizziness of freedom.", "by": "Søren Kierkegaard, The Concept of Anxiety"},
  {"text": "The question of whether machines can think is about as relevant as the question of whether submarines can swim.", "by": "Edsger Dijkstra"},
  {"text": "The fish trap exists because of the fish; once you've gotten the fish, you can forget the trap. Words exist because of meaning; once you've gotten the meaning, you can forget the words. Where can I find a man who has forgotten words so I can have a word with him?", "by": "Zhuangzi"},
  {"text": "Thirty spokes share one hub; it is the empty space that makes the cart useful.", "by": "Laozi, Tao Te Ching"},
  {"text": "When I play with my cat, who knows if I am not a pastime to her more than she is to me?", "by": "Michel de Montaigne, Essays"},
  {"text": "Grace fills empty spaces, but it can only enter where there is a void to receive it.", "by": "Simone Weil, Gravity and Grace"},
  {"text": "The purpose of a system is what it does.", "by": "Stafford Beer"},
  {"text": "He who cannot draw on three thousand years is living from hand to mouth.", "by": "Johann Wolfgang von Goethe, West-Eastern Divan"},
  {"text": "I am rooted, but I flow.", "by": "Virginia Woolf, The Waves"},
  {"text": "The relation between what we see and what we know is never settled.", "by": "John Berger, Ways of Seeing"},
  {"text": "Seek and learn to recognize who and what, in the midst of the inferno, are not inferno, then make them endure, give them space.", "by": "Italo Calvino, Invisible Cities"},
  {"text": "I will have spent my life trying to understand the function of remembering, which is not the opposite of forgetting, but rather its lining.", "by": "Chris Marker, Sans Soleil"},
  {"text": "Humankind cannot bear very much reality.", "by": "T. S. Eliot, Burnt Norton"},
  {"text": "People are trapped in history and history is trapped in them.", "by": "James Baldwin, Stranger in the Village"},
  {"text": "To go wrong in one's own way is better than to go right in someone else's.", "by": "Fyodor Dostoevsky, Crime and Punishment"},
  {"text": "If a lion could talk, we could not understand him.", "by": "Ludwig Wittgenstein, Philosophical Investigations"},
  {"text": "I cannot say whether things will get better if we change; what I can say is they must change if they are to get better.", "by": "Georg Christoph Lichtenberg"},
  {"text": "You must change your life.", "by": "Rainer Maria Rilke, Archaic Torso of Apollo"},
  {"text": "Man is least himself when he talks in his own person. Give him a mask, and he will tell you the truth.", "by": "Oscar Wilde, The Critic as Artist"},
  {"text": "Where there is power, there is resistance.", "by": "Michel Foucault, The History of Sexuality"},
  {"text": "All things excellent are as difficult as they are rare.", "by": "Baruch Spinoza, Ethics"},
  {"text": "For beauty is nothing but the beginning of terror, which we are still just able to endure.", "by": "Rainer Maria Rilke, Duino Elegies"},
  {"text": "If man were never to fade away like the dews of Adashino, how things would lose their power to move us! The most precious thing in life is its uncertainty.", "by": "Yoshida Kenkō, Essays in Idleness"},
  {"text": "The cradle rocks above an abyss, and common sense tells us that our existence is but a brief crack of light between two eternities of darkness.", "by": "Vladimir Nabokov, Speak, Memory"},
  {"text": "The poet is a faker who's so good at his act he even fakes the pain of pain he feels in fact.", "by": "Fernando Pessoa, Autopsychography"},
  {"text": "Monsters exist, but they are too few in number to be truly dangerous. More dangerous are the common men.", "by": "Primo Levi"},
  {"text": "A language that doesn't affect the way you think about programming is not worth knowing.", "by": "Alan Perlis, Epigrams on Programming"},
  {"text": "The owl of Minerva spreads its wings only with the falling of the dusk.", "by": "G. W. F. Hegel, Philosophy of Right"},
  {"text": "The fox knows many things, but the hedgehog knows one big thing.", "by": "Archilochus"},
  {"text": "Talent hits a target no one else can hit. Genius hits a target no one else can see.", "by": "Arthur Schopenhauer"},
  {"text": "Cities, like dreams, are made of desires and fears.", "by": "Italo Calvino, Invisible Cities"},
  {"text": "The only true voyage of discovery would be not to visit strange lands but to possess other eyes.", "by": "Marcel Proust, The Captive"},
  {"text": "There is no document of civilization which is not at the same time a document of barbarism.", "by": "Walter Benjamin, Theses on the Philosophy of History"},
  {"text": "A complex system that works is invariably found to have evolved from a simple system that worked.", "by": "John Gall, Systemantics"},
  {"text": "To study the self is to forget the self.", "by": "Dōgen, Genjōkōan"},
  {"text": "Fact creates norms, and truth illumination.", "by": "Werner Herzog, Minnesota Declaration"},
  {"text": "Real generosity toward the future lies in giving all to the present.", "by": "Albert Camus, The Rebel"},
  {"text": "Make visible what, without you, might perhaps never have been seen.", "by": "Robert Bresson, Notes on the Cinematographer"},
  {"text": "To photograph is to appropriate the thing photographed.", "by": "Susan Sontag, On Photography"},
  {"text": "Nature loves to hide.", "by": "Heraclitus"},
  {"text": "We are all patchwork, and so shapeless and diverse in composition that each bit, each moment, plays its own game.", "by": "Michel de Montaigne, Essays"},
  {"text": "In individuals, insanity is rare; but in groups, parties, nations and epochs, it is the rule.", "by": "Friedrich Nietzsche, Beyond Good and Evil"},
  {"text": "All real living is meeting.", "by": "Martin Buber, I and Thou"},
  {"text": "A thing is not necessarily true because a man dies for it.", "by": "Oscar Wilde, The Portrait of Mr. W. H."},
  {"text": "What we observe is not nature itself, but nature exposed to our method of questioning.", "by": "Werner Heisenberg, Physics and Philosophy"},
  {"text": "此中有真意，欲辨已忘言。", "by": "陶渊明，《饮酒·其五》"},
  {"text": "In mathematics you don't understand things. You just get used to them.", "by": "John von Neumann"},
  {"text": "To think is to forget differences, generalize, make abstractions.", "by": "Jorge Luis Borges, Funes the Memorious"},
  {"text": "We are so accustomed to disguise ourselves to others that in the end we become disguised to ourselves.", "by": "François de La Rochefoucauld, Maxims"},
  {"text": "The crisis consists precisely in the fact that the old is dying and the new cannot be born; in this interregnum a great variety of morbid symptoms appear.", "by": "Antonio Gramsci, Prison Notebooks"},
  {"text": "The function of the imagination is not to make strange things settled, so much as to make settled things strange.", "by": "G. K. Chesterton, The Defendant"},
  {"text": "To define is to limit.", "by": "Oscar Wilde, The Picture of Dorian Gray"},
  {"text": "The way up and the way down are one and the same.", "by": "Heraclitus"},
  {"text": "你未看此花时，此花与汝心同归于寂；你来看此花时，则此花颜色一时明白起来。", "by": "王阳明，《传习录》"},
  {"text": "Seeing comes before words.", "by": "John Berger, Ways of Seeing"},
  {"text": "Someone will remember us, I say, even in another time.", "by": "Sappho"},
  {"text": "The only thing that makes life possible is permanent, intolerable uncertainty: not knowing what comes next.", "by": "Ursula K. Le Guin, The Left Hand of Darkness"},
  {"text": "The trouble with our times is that the future is not what it used to be.", "by": "Paul Valéry"},
  {"text": "A mathematician, like a painter or a poet, is a maker of patterns.", "by": "G. H. Hardy, A Mathematician's Apology"},
  {"text": "To live is to be other.", "by": "Fernando Pessoa, The Book of Disquiet"},
  {"text": "The tragedy of old age is not that one is old, but that one is young.", "by": "Oscar Wilde, The Picture of Dorian Gray"},
  {"text": "Man is only a reed, the weakest in nature, but he is a thinking reed.", "by": "Blaise Pascal, Pensées"},
  {"text": "When a measure becomes a target, it ceases to be a good measure.", "by": "Marilyn Strathern, after Charles Goodhart"},
  {"text": "Don't think, but look!", "by": "Ludwig Wittgenstein, Philosophical Investigations"},
  {"text": "We are the bees of the invisible.", "by": "Rainer Maria Rilke, letter to Witold Hulewicz"},
  {"text": "Nothing is more real than nothing.", "by": "Samuel Beckett, Malone Dies"},
  {"text": "The spectacle is not a collection of images, but a social relation among people, mediated by images.", "by": "Guy Debord, The Society of the Spectacle"},
  {"text": "I prefer the absurdity of writing poems to the absurdity of not writing poems.", "by": "Wisława Szymborska, Possibilities"},
  {"text": "Mirrors and copulation are abominable, because they increase the number of men.", "by": "Jorge Luis Borges, Tlön, Uqbar, Orbis Tertius"},
  {"text": "The struggle of man against power is the struggle of memory against forgetting.", "by": "Milan Kundera, The Book of Laughter and Forgetting"},
  {"text": "Imaginary evil is romantic and varied; real evil is gloomy, monotonous, barren, boring. Imaginary good is boring; real good is always new, marvellous, intoxicating.", "by": "Simone Weil, Gravity and Grace"},
  {"text": "Storytelling reveals meaning without committing the error of defining it.", "by": "Hannah Arendt, Men in Dark Times"},
  {"text": "Philosophy is a battle against the bewitchment of our intelligence by means of language.", "by": "Ludwig Wittgenstein, Philosophical Investigations"},
  {"text": "It is better to fail in originality than to succeed in imitation.", "by": "Herman Melville, Hawthorne and His Mosses"},
  {"text": "If there is a sense of reality, there must also be a sense of possibility.", "by": "Robert Musil, The Man Without Qualities"},
  {"text": "Hypocrisy is the homage vice pays to virtue.", "by": "François de La Rochefoucauld, Maxims"},
  {"text": "We have art in order not to die of the truth.", "by": "Friedrich Nietzsche"},
  {"text": "We don't want to conquer the cosmos, we simply want to extend the boundaries of Earth to the frontiers of the cosmos. We don't need other worlds. We need mirrors.", "by": "Stanisław Lem, Solaris"},
  {"text": "Everything we see hides another thing; we always want to see what is hidden by what we see.", "by": "René Magritte"},
  {"text": "Information is a difference which makes a difference.", "by": "Gregory Bateson"},
  {"text": "We look at the present through a rear-view mirror. We march backwards into the future.", "by": "Marshall McLuhan, The Medium Is the Massage"},
  {"text": "The sad truth is that most evil is done by people who never make up their minds to be good or evil.", "by": "Hannah Arendt, The Life of the Mind"},
  {"text": "Convictions are more dangerous enemies of truth than lies.", "by": "Friedrich Nietzsche, Human, All Too Human"},
  {"text": "There is an infinite amount of hope, but not for us.", "by": "Franz Kafka"},
  {"text": "The butterfly counts not months but moments, and has time enough.", "by": "Rabindranath Tagore, Fireflies"},
  {"text": "Hell is not to love any more.", "by": "Georges Bernanos, The Diary of a Country Priest"},
  {"text": "In the beginner's mind there are many possibilities, but in the expert's there are few.", "by": "Shunryu Suzuki, Zen Mind, Beginner's Mind"},
  {"text": "A cage went in search of a bird.", "by": "Franz Kafka, Zürau Aphorisms"},
  {"text": "A book is a mirror: if an ass peers into it, you can't expect an apostle to look out.", "by": "Georg Christoph Lichtenberg"},
  {"text": "Civilization advances by extending the number of important operations which we can perform without thinking about them.", "by": "Alfred North Whitehead, An Introduction to Mathematics"},
  {"text": "We can know more than we can tell.", "by": "Michael Polanyi, The Tacit Dimension"},
  {"text": "We shape our tools and thereafter our tools shape us.", "by": "John Culkin, on Marshall McLuhan"},
  {"text": "Everything has been said before, but since nobody listens we have to keep going back and beginning all over again.", "by": "André Gide"},
  {"text": "The price of anything is the amount of life you exchange for it.", "by": "Henry David Thoreau, Walden"},
  {"text": "But where danger is, grows the saving power also.", "by": "Friedrich Hölderlin, Patmos"},
  {"text": "Reason is, and ought only to be the slave of the passions.", "by": "David Hume, A Treatise of Human Nature"},
  {"text": "Every photograph is a certificate of presence.", "by": "Roland Barthes, Camera Lucida"},
  {"text": "Vertigo is something other than the fear of falling. It is the voice of the emptiness below us which tempts and lures us.", "by": "Milan Kundera, The Unbearable Lightness of Being"},
  {"text": "Are we to look at cherry blossoms only in full bloom, the moon only when it is cloudless?", "by": "Yoshida Kenkō, Essays in Idleness"},
  {"text": "Love is the extremely difficult realisation that something other than oneself is real.", "by": "Iris Murdoch, The Sublime and the Good"},
  {"text": "I am nothing. I'll always be nothing. I can't want to be something. But I have in me all the dreams of the world.", "by": "Fernando Pessoa (Álvaro de Campos), Tobacco Shop"},
  {"text": "Build your film on white, on silence and on stillness.", "by": "Robert Bresson, Notes on the Cinematographer"},
  {"text": "Man is a creature who makes pictures of himself and then comes to resemble the picture.", "by": "Iris Murdoch"},
  {"text": "In a world that really has been turned on its head, the true is a moment of the false.", "by": "Guy Debord, The Society of the Spectacle"},
  {"text": "To see what is in front of one's nose needs a constant struggle.", "by": "George Orwell, In Front of Your Nose"},
  {"text": "The aim of art is to prepare a person for death, to plough and harrow his soul, rendering it capable of turning to good.", "by": "Andrei Tarkovsky, Sculpting in Time"},
  {"text": "Life is not a series of gig lamps symmetrically arranged; life is a luminous halo, a semi-transparent envelope surrounding us from the beginning of consciousness to the end.", "by": "Virginia Woolf, Modern Fiction"},
  {"text": "Curiosity is insubordination in its purest form.", "by": "Vladimir Nabokov, Bend Sinister"},
  {"text": "Every exit is an entry somewhere else.", "by": "Tom Stoppard, Rosencrantz and Guildenstern Are Dead"},
  {"text": "We all have strength enough to endure the misfortunes of others.", "by": "François de La Rochefoucauld, Maxims"},
  {"text": "We find beauty not in the thing itself but in the patterns of shadows, the light and the darkness, that one thing against another creates.", "by": "Jun'ichirō Tanizaki, In Praise of Shadows"},
  {"text": "The opposite of a correct statement is a false statement. But the opposite of a profound truth may well be another profound truth.", "by": "Niels Bohr"},
  {"text": "Mathematics is the art of giving the same name to different things.", "by": "Henri Poincaré"},
  {"text": "Nothing in life is as important as you think it is, while you are thinking about it.", "by": "Daniel Kahneman, Thinking, Fast and Slow"},
  {"text": "All the world is not a stage, but the crucial ways in which it isn't are not easy to specify.", "by": "Erving Goffman, Frame Analysis"},
  {"text": "死是一件不必急于求成的事，死是一个必然会降临的节日。", "by": "史铁生，《我与地坛》"},
  {"text": "We do not inhabit a country; we inhabit a language.", "by": "Emil Cioran"},
  {"text": "The aim of argument, or of discussion, should not be victory, but progress.", "by": "Joseph Joubert"},
];

function dailyQuote(d) {
  const [y, m, day] = QUOTE_START.split('-').map(Number);
  const i = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(y, m - 1, day)) / DAY);
  return { quote: QUOTES[i] ?? null, left: QUOTES.length - i };
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

function parseOptions(source) {
  const opts = { ...DEFAULTS };
  for (const line of source.split('\n')) {
    const m = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
    if (m && m[1] in DEFAULTS) opts[m[1]] = m[2];
  }
  return opts;
}

// Minutes after local midnight for "H:MM".
function clockMinutes(s) {
  const [h, m = 0] = s.split(':').map(Number);
  return h * 60 + m;
}

// NOAA's approximation: local minutes after midnight of sunrise and sunset,
// or null on a polar day/night.
function sunTimes(day, lat, lon) {
  const rad = Math.PI / 180;
  const utcMidnight = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  const g = (2 * Math.PI / 365) * ((utcMidnight - Date.UTC(day.getFullYear(), 0, 0)) / 864e5 - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  if (cosH < -1 || cosH > 1) return null;
  const ha = Math.acos(cosH) / rad;
  const local = (utcMin) => {
    const d = new Date(utcMidnight + utcMin * MIN);
    return d.getHours() * 60 + d.getMinutes();
  };
  return { rise: local(720 - 4 * (lon + ha) - eq), set: local(720 - 4 * (lon - ha) - eq) };
}

const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = (c) => `rgb(${c.join(' ')})`;

// DayTime's sky colours, keyed to the real sun: dawn at sunrise, the gold hour
// before sunset, the coral at sunset, dusk and then night after it. Bedtime has
// nothing to do with it. Blended with a smoothstep, so the page drifts through
// the day like a real sky. Hours in, local time.
// [hour, sky top, sky bottom, stars, ink, glow]
// With `sky: off` the ink colours the emphasised words, and the ring runs
// from ink to glow: one colour per hour, bright enough to read on a plain note.
function sky(h, rise, set) {
  const noon = (rise + set) / 2;
  const keys = [
    [0, 0x03040c, 0x0a0e26, 1, 0x1f4fc4, 0x173a8f], // midnight: deep blue
    [rise - 1.2, 0x05071a, 0x161a40, 0.9, 0x2f62d4, 0x5a9ae6], // first light
    [rise, 0x2b2a5e, 0xe9967a, 0.25, 0xec7a6a, 0xf3a16b], // sunrise
    [rise + 1, 0x4f86c6, 0xf7d9b5, 0, 0xe89b3c, 0x5ea8e8], // morning
    [noon, 0x2a6fd1, 0xa6d8f7, 0, 0x2f86e8, 0x34c0e0], // midday
    [Math.max(set - 2.5, noon + 0.5), 0x3a5fa8, 0xf5c27a, 0, 0xe39a1f, 0xf2c14e], // golden hour
    [set, 0x2a2c66, 0xf07b5f, 0.1, 0xef6a4a, 0xd9577a], // sunset
    [set + 0.75, 0x151a40, 0x7a4f8f, 0.55, 0x3a64cc, 0xe07a8a], // dusk
    [Math.min(set + 1.75, 23.9), 0x060818, 0x151a3d, 1, 0x1f4fc4, 0x173a8f], // night
    [24, 0x03040c, 0x0a0e26, 1, 0x1f4fc4, 0x173a8f],
  ];
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= h) i++;
  const a = keys[i], b = keys[i + 1];
  let t = b[0] > a[0] ? Math.min(Math.max((h - a[0]) / (b[0] - a[0]), 0), 1) : 0;
  t = t * t * (3 - 2 * t);
  const at = (k) => mix(rgb(a[k]), rgb(b[k]), t);
  const top = at(1), bottom = at(2);
  return { top, mid: mix(top, bottom, 0.45), bottom, stars: a[3] + (b[3] - a[3]) * t, ink: at(4), glow: at(5) };
}

const pad = (n) => String(n).padStart(2, '0');
const duration = (min) => (Math.floor(min / 60) ? `${Math.floor(min / 60)}h ${min % 60}min` : `${min}min`);
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plural = (n, word) => `${word}${n === 1 ? '' : 's'}`;
// Past a day, hours and minutes get long; "6d 21h" instead.
const until = (min) => (min < 24 * 60 ? duration(min) : `${Math.floor(min / 1440)}d ${Math.floor(min % 1440 / 60)}h`);

// A reminder's due date as a pill: the time if it is today ("16:30"), else
// "Yesterday" or the date ("Oct 14"), with the time after it when it has one.
// Reminders reports a date without a time as local midnight.
function dueLabel(iso, today) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const timed = d.getHours() || d.getMinutes();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((new Date(today).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / DAY);
  const overdue = days > 0 || (days === 0 && timed && d < today);
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const text = days === 0 ? (timed ? time : day) : timed ? `${day} ${time}` : day;
  return { text, overdue };
}

// Apple Reminders, through remindctl (github.com/openclaw/remindctl). Obsidian
// starts without the shell's PATH, so look where Homebrew puts it.
const REMINDCTL = ['/opt/homebrew/bin/remindctl', '/usr/local/bin/remindctl'];
function remindctl(...args) {
  if (!Platform.isMacOS || !Platform.isDesktopApp) return null;
  const fs = require('fs');
  const bin = REMINDCTL.find((p) => fs.existsSync(p));
  if (!bin) return null;
  return new Promise((resolve, reject) => {
    require('child_process').execFile(bin, [...args, '--json', '--no-input'], { timeout: 15000 },
      (err, out) => (err ? reject(err) : resolve(out)));
  });
}

// Apple Calendar, through icalBuddy (`brew install ical-buddy`), which asks
// Calendar itself; the database macOS keeps it in is closed to other apps.
// One line per event, "Title<tab>2026-10-20 at 13:30 - 14:00", all-day events
// left out; icalBuddy sometimes drops the date ("Title<tab>13:30 - 14:00"), and
// then it is today. Ones already under way are dropped when shown.
const ICALBUDDY = ['/opt/homebrew/bin/icalBuddy', '/usr/local/bin/icalBuddy'];
function nextEvents(calendars) {
  if (!Platform.isMacOS || !Platform.isDesktopApp) return null;
  const fs = require('fs');
  const bin = ICALBUDDY.find((p) => fs.existsSync(p));
  if (!bin) return null;
  const args = ['-n', '-nc', '-nrd', '-ea', '-b', '', '-ps', '|\t|', '-iep', 'title,datetime',
    '-df', '%Y-%m-%d', '-tf', '%H:%M', '-li', '8'];
  const only = calendars.split(',').map((c) => c.trim()).filter(Boolean).join(',');
  if (only) args.push('-ic', only);
  args.push('eventsToday');
  return new Promise((resolve, reject) => {
    require('child_process').execFile(bin, args, { timeout: 15000 }, (err, out) => {
      if (err) return reject(err);
      const today = new Date();
      resolve(out.split('\n').map((line) => {
        const m = line.match(/^(.*)\t(?:(\d{4})-(\d\d)-(\d\d) at )?(\d\d):(\d\d)/);
        if (!m) return null;
        const day = m[2] ? new Date(m[2], m[3] - 1, m[4]) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
        day.setHours(m[5], m[6]);
        return { title: m[1], start: day.getTime() / 1000 };
      }).filter(Boolean));
    });
  });
}

class HomeView extends MarkdownRenderChild {
  constructor(plugin, el, opts, sourcePath) {
    super(el);
    this.app = plugin.app;
    this.plugin = plugin;
    this.cache = plugin.cache;
    this.opts = opts;
    this.sourcePath = sourcePath;
    this.wake = clockMinutes(opts.wake);
    this.bed = clockMinutes(opts.bed);
  }

  onload() {
    const root = this.containerEl;
    root.addClass('home-view');
    root.dataset.sky = this.opts.sky === 'off' ? 'off' : 'on';
    // Keep clicks inside the block so Live Preview doesn't flip into source mode.
    this.registerDomEvent(root, 'mousedown', (e) => e.stopPropagation());
    this.registerDomEvent(root, 'click', (e) => e.stopPropagation());

    // One left-aligned column: greeting, quote, then the stanza of time, date
    // and day left with the ring to its right, then the items and the event.
    const layout = root.createDiv('hv-layout');
    const head = layout.createDiv('hv-head');
    this.greetEl = head.createEl('p', 'hv-greeting');
    this.quoteEl = head.createDiv('hv-quote');
    // The "now" block: the stanza with the ring to its right, as one unit.
    const now = head.createDiv('hv-now');
    const stanza = now.createDiv('hv-stanza');
    this.nowEl = stanza.createEl('p');
    this.dateEl = stanza.createEl('p');
    this.statusEl = stanza.createEl('p');
    const dials = now.createDiv('hv-dials');
    this.buildRing(dials.createDiv({ cls: 'hv-dial hv-ring', attr: { role: 'img' } }));
    this.itemsEl = layout.createDiv('hv-items');
    this.eventEl = layout.createEl('p', 'hv-event');

    // Start from what the last widget fetched, so a fresh render (Reading view,
    // reopening the note) shows reminders and the next event at once; the
    // fetches below then bring them up to date.
    this.reminders = this.opts.reminders === 'off' ? [] : this.cache.reminders.map((r) => ({ ...r }));
    // No events (null) until Calendar has answered: the line stays hidden.
    this.events = this.opts.calendar === 'off' || this.cache.calendars !== this.opts.calendars ? null : this.cache.events;
    this.tick();
    this.renderItems();
    this.loadReminders();
    this.loadEvents();

    // Wake on each minute boundary, then every minute after it.
    const t = window.setTimeout(() => {
      this.tick();
      this.registerInterval(window.setInterval(() => this.tick(), MIN));
    }, MIN - (Date.now() % MIN) + 50);
    this.register(() => window.clearTimeout(t));
    // Catch up as soon as the page is seen again: back to the app, back to the
    // tab, or the screen woken up.
    const catchUp = () => this.tick();
    this.registerDomEvent(window, 'focus', catchUp);
    this.registerDomEvent(document, 'visibilitychange', catchUp);
    this.registerEvent(this.app.workspace.on('active-leaf-change', catchUp));
    this.registerEvent(this.app.workspace.on('layout-change', catchUp));

    const prefix = this.opts.folder.replace(/\/?$/, '/');
    const inFolder = (path) => typeof path === 'string' && path.startsWith(prefix);
    const refresh = (file, oldPath) => { if (inFolder(file.path) || inFolder(oldPath)) this.renderItems(); };
    this.registerEvent(this.app.vault.on('create', refresh));
    this.registerEvent(this.app.vault.on('delete', refresh));
    this.registerEvent(this.app.vault.on('rename', refresh));
    this.registerEvent(this.app.metadataCache.on('changed', refresh));

    // Reminders and events change in other apps, so look again whenever the
    // page comes back into view, and every five minutes.
    const reload = () => { this.loadReminders(); this.loadEvents(); };
    this.registerDomEvent(window, 'focus', reload);
    this.registerDomEvent(document, 'visibilitychange', () => { if (!document.hidden) reload(); });
    this.registerInterval(window.setInterval(reload, 5 * MIN));
  }

  // Bring the widget to the current minute. It doesn't jump there: from the
  // time it last showed it winds through the minutes in between, so after an
  // hour away the hands sweep, the numbers count and the sky shifts into place.
  // While the page can't be seen it waits, so the catch-up plays in view.
  // The dev slider asks for `instant`.
  tick(instant = false) {
    const real = new Date();
    const dev = this.pane?.hvDev;
    const target = dev?.time == null ? real
      : new Date(real.getFullYear(), real.getMonth(), real.getDate(), Math.floor(dev.time / 60), dev.time % 60);
    target.setSeconds(0, 0);
    const to = target.getTime(), from = this.shownAt;
    if (from == null || instant) return this.show(to);
    if (from === to || document.hidden || !this.containerEl.isShown()) return;
    if (Math.abs(to - from) > DAY || reducedMotion()) return this.show(to);

    // Longer gaps take a little longer, up to a second and a half.
    const ms = Math.min(350 + 220 * Math.log2(1 + Math.abs(to - from) / MIN), 1500);
    let start = null;
    const step = (t) => {
      start ??= t;
      const p = Math.min((t - start) / ms, 1);
      this.anim = p < 1 ? requestAnimationFrame(step) : 0;
      this.render(new Date(from + (to - from) * easeInOut(p)));
    };
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = requestAnimationFrame(step);
  }

  renderQuote(d) {
    const el = this.quoteEl;
    if (this.opts.quote === 'off') return el.hide();
    const today = dailyQuote(d);
    el.empty();
    if (!today?.quote) return el.hide();
    el.show();
    // The source runs on after the quote, on the same line.
    const p = el.createEl('p', { cls: 'hv-quote-text', text: `${today.quote.text} ` });
    p.createSpan({ cls: 'hv-quote-by', text: `— ${today.quote.by}` });
    // Ask for more before the list runs dry, once a day.
    if (today.left <= 14 && this.plugin.warnedDay !== this.day) {
      this.plugin.warnedDay = this.day;
      new Notice(`Home View: ${today.left} daily quote${today.left === 1 ? '' : 's'} left in main.js.`);
    }
  }

  show(ms) {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = 0;
    this.render(new Date(ms));
  }

  // Draw the widget at moment `d`, which mid-animation falls between minutes.
  render(d) {
    this.shownAt = d.getTime();
    const now = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / MIN;
    if (dateKey(d) !== this.day) {
      this.day = dateKey(d);
      const lat = parseFloat(this.opts.lat), lon = parseFloat(this.opts.lon);
      const sun = isNaN(lat) || isNaN(lon) ? null : sunTimes(d, lat, lon);
      this.rise = sun?.rise ?? this.wake;
      // Without a location the sky assumes a 6:30 sunrise and a 19:30 sunset.
      this.sun = sun ?? { rise: 390, set: 1170 };
      if (this.itemsEl.childElementCount) { this.renderItems(); this.loadReminders(); this.loadEvents(); }
      this.renderQuote(d);
    }
    const remaining = Math.min(Math.max((this.bed - now) / (this.bed - this.wake), 0), 1);
    this.paint(now);

    const h = d.getHours();
    const part = h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'afternoon' : 'evening';
    // The name is its own span so a narrow pane can put it on the second line.
    this.greetEl.empty();
    const name = this.opts.name === 'random' ? dailyName(this.day) : this.opts.name;
    if (name) {
      this.greetEl.appendText(`Good ${part}, `);
      this.greetEl.createSpan({ cls: 'hv-name', text: `${name}.` });
    } else {
      this.greetEl.setText(`Good ${part}.`);
    }

    this.nowEl.empty();
    this.nowEl.appendText('It is now ');
    this.nowEl.createSpan({ cls: 'hv-key hv-num', text: `${pad(h)}:${pad(d.getMinutes())}` });
    this.nowEl.appendText('.');
    this.dateEl.setText(`Today is ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}.`);

    const s = this.statusEl;
    s.empty();
    const mode = now >= this.wake && now < this.bed ? 'day' : now >= this.rise && now < this.wake ? 'dawn' : 'night';
    if (mode === 'day') {
      s.appendText('You have ');
      s.createSpan({ cls: 'hv-key hv-num', text: duration(this.bed - Math.floor(now)) });
      s.appendText(' left for today.');
    } else if (mode === 'dawn') {
      s.createSpan({ cls: 'hv-key', text: 'Congratulations' });
      s.appendText(', you woke up early today.');
    } else {
      s.appendText('You should be ');
      s.createSpan({ cls: 'hv-key', text: 'sleeping' });
      s.appendText(' by now.');
    }

    this.setRing(mode, remaining);
    this.renderEvent(d);
  }

  async loadEvents() {
    if (this.opts.calendar === 'off') return;
    try {
      const events = await nextEvents(this.opts.calendars);
      if (!events) return;
      this.events = events;
      Object.assign(this.cache, { events, calendars: this.opts.calendars });
    } catch (err) {
      console.warn('Home View: could not read Apple Calendar', err);
      return;
    }
    if (!this.gone) this.renderEvent(new Date(this.shownAt));
  }

  // "Your next event is X, in 2h 15min." Counted down with the clock; once an
  // event starts, the next one today takes its place. With none left today it
  // says so, and without Calendar (off, not a Mac, no icalBuddy) it is hidden.
  renderEvent(d) {
    const el = this.eventEl;
    el.empty();
    el.toggle(!!this.events);
    if (!this.events) return;
    const next = this.events.find((e) => e.start * 1000 > d.getTime() && dateKey(new Date(e.start * 1000)) === dateKey(d));
    if (!next) {
      el.appendText('You have no upcoming event for today. Enjoy your ');
      el.createSpan({ cls: 'hv-key', text: 'freedom' });
      el.appendText('.');
      return;
    }
    el.appendText('Your next event is ');
    el.createSpan({ cls: 'hv-key', text: next.title || 'untitled' });
    el.appendText(', in ');
    el.createSpan({ cls: 'hv-key hv-num', text: until(Math.ceil((next.start * 1000 - d.getTime()) / MIN)) });
    el.appendText('.');
  }

  // DayTime's ring: the percent of the waking day left, 100 at wake-up and 1 just
  // before bed. Before wake-up it holds DayTime's sun, after bedtime its moon.
  buildRing(el) {
    const r = 44;
    this.circumference = 2 * Math.PI * r;
    // The ring's gradient runs top (ink) to bottom (glow) on screen; the circle is turned -90°,
    // so in its own frame that is right to left. The id is per block, since
    // Live Preview can hold two copies of the block at once.
    const id = `hv-ink-${++inkIds}`;
    this.containerEl.style.setProperty('--hv-ring-ink', `url(#${id})`);
    el.innerHTML = `<svg viewBox="0 0 100 100"><defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="94" y1="50" x2="6" y2="50">`
      + '<stop offset="0" style="stop-color: var(--hv-tint)"/><stop offset="1" style="stop-color: var(--hv-glow)"/></linearGradient></defs>'
      + `<circle class="hv-ring-track" cx="50" cy="50" r="${r}"/>`
      + `<circle class="hv-ring-fill" cx="50" cy="50" r="${r}" stroke-dasharray="${this.circumference}" transform="rotate(-90 50 50)"/></svg>`;
    this.ringFill = el.querySelector('.hv-ring-fill');
    this.ringLabel = el.createDiv('hv-ring-label');
    this.ringEl = el;
  }

  setRing(mode, remaining) {
    const pct = mode === 'day' ? Math.min(Math.max(Math.ceil(remaining * 100 - 1e-9), 1), 100) : mode === 'dawn' ? 100 : 0;
    // The arc follows the exact fraction, so it drains smoothly under the whole-number label.
    const fill = mode === 'day' ? Math.max(remaining, 0.01) : mode === 'dawn' ? 1 : 0;
    this.ringFill.style.strokeDashoffset = String(this.circumference * (1 - fill));
    this.ringEl.dataset.mode = mode;
    const label = this.ringLabel;
    label.empty();
    if (mode === 'day') {
      label.createSpan({ cls: 'hv-ring-num', text: String(pct) })
        .createSpan({ cls: 'hv-ring-pct', text: '%' });
      this.ringEl.setAttr('aria-label', `${pct}% of today left`);
    } else {
      setIcon(label, mode === 'dawn' ? 'sun' : 'moon');
      this.ringEl.setAttr('aria-label', mode === 'dawn' ? 'The day has not started yet' : 'Night');
    }
  }

  // The colours of the hour. With the sky on they are painted on the whole
  // pane, not just the block: the nearest .workspace-leaf-content gets them as
  // variables (styles.css draws the gradient) and a layer of stars. With the
  // sky off they colour the emphasised words and the ring instead. The dev panel
  // sits on the pane either way. Undone when the block goes away.
  paint(now) {
    const s = sky(now / 60, this.sun.rise / 60, this.sun.set / 60);
    const root = this.containerEl;
    root.style.setProperty('--hv-tint', css(s.ink));
    root.style.setProperty('--hv-glow', css(s.glow));

    const pane = root.closest('.workspace-leaf-content');
    if (!pane) {
      // Not in the document yet on the first render; try again next frame.
      if (!this.paneRetry) this.paneRetry = requestAnimationFrame(() => { this.paneRetry = 0; this.show(this.shownAt); });
      return;
    }
    // Re-applied on every paint, not just the first: while re-rendering, Live
    // Preview briefly makes a throwaway copy of the block, and when that copy
    // unloads it takes the sky down with it.
    this.pane = pane;
    pane.hvOwner = this;
    if (this.opts.dev === 'on' && !pane.querySelector(':scope > .hv-dev')) this.buildDev(pane);
    if (this.opts.sky === 'off') return;
    pane.addClass('hv-sky');
    if (!pane.querySelector(':scope > .hv-stars')) this.buildStars(pane);
    pane.style.setProperty('--hv-sky-top', css(s.top));
    pane.style.setProperty('--hv-sky-mid', css(s.mid));
    pane.style.setProperty('--hv-sky-bottom', css(s.bottom));
    pane.style.setProperty('--hv-stars', s.stars.toFixed(2));
  }

  // Dev panel: scrub the time of day. Its state lives on
  // the pane, so it survives Live Preview re-rendering the block.
  buildDev(pane) {
    pane.hvDev = pane.hvDev ?? { time: null };
    const el = pane.createDiv('hv-dev');
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    const row = (label) => {
      const r = el.createDiv('hv-dev-row');
      r.createSpan({ cls: 'hv-dev-label', text: label });
      const input = r.createEl('input', { type: 'range' });
      const value = r.createSpan('hv-dev-value');
      return { input, value };
    };
    const redraw = () => pane.hvOwner?.tick(true);

    const time = row('Time');
    time.input.min = '0'; time.input.max = '1435'; time.input.step = '5';
    const now = el.createEl('button', { cls: 'hv-dev-now', text: 'Now' });
    const showTime = () => {
      const t = pane.hvDev.time;
      const live = new Date();
      const m = t ?? live.getHours() * 60 + live.getMinutes();
      time.input.value = String(m);
      time.value.setText(t == null ? 'live' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    };
    time.input.addEventListener('input', () => { pane.hvDev.time = +time.input.value; showTime(); redraw(); });
    now.addEventListener('click', () => { pane.hvDev.time = null; showTime(); redraw(); });

    showTime();
  }

  // A fixed scatter, seeded so the stars don't jump between renders.
  buildStars(pane) {
    const el = pane.createDiv('hv-stars');
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++) {
      const star = el.createDiv('hv-star');
      star.style.left = `${rand() * 100}%`;
      star.style.top = `${rand() * 75}%`;
      star.style.setProperty('--a', (0.25 + rand() * 0.6).toFixed(2));
      star.style.setProperty('--d', `${(rand() * 5).toFixed(1)}s`);
      if (rand() > 0.88) star.addClass('is-bright');
    }
    return el;
  }

  onunload() {
    this.gone = true;
    if (this.paneRetry) cancelAnimationFrame(this.paneRetry);
    if (this.anim) cancelAnimationFrame(this.anim);
    const pane = this.pane;
    // Live Preview re-renders the block often; only the newest one cleans up.
    if (!pane || pane.hvOwner !== this) return;
    pane.removeClass('hv-sky');
    pane.querySelector(':scope > .hv-stars')?.remove();
    pane.querySelector(':scope > .hv-dev')?.remove();
    delete pane.hvDev;
    for (const k of ['--hv-sky-top', '--hv-sky-mid', '--hv-sky-bottom', '--hv-stars']) pane.style.removeProperty(k);
    delete pane.hvOwner;
  }

  files() {
    const folder = this.app.vault.getAbstractFileByPath(this.opts.folder.replace(/\/$/, ''));
    if (!(folder instanceof TFolder)) return [];
    const out = [];
    const walk = (f) => f.children.forEach((c) => (c instanceof TFolder ? walk(c) : out.push(c)));
    walk(folder);
    // A note whose `descriptive` (a string or a list) says `done` is finished.
    // A recurring todo (`todo` + `recurring`) lives in the folder for good;
    // it is not an action item for today.
    const values = (fm) => [fm.descriptive ?? []].flat().map((v) => String(v).trim().toLowerCase());
    const isDone = (v) => v.includes('done');
    const isRecurring = (v) => v.includes('todo') && v.includes('recurring');
    return out.filter((file) => {
      const v = values(this.app.metadataCache.getFileCache(file)?.frontmatter ?? {});
      return !isDone(v) && !isRecurring(v);
    }).map((file) => {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const due = fm['due date'] ?? fm.due;
      // Soonest due first; notes without a due date after them, by name.
      return { file, sortKey: String(due ?? '9999') };
    }).sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.file.basename.localeCompare(b.file.basename));
  }

  // Incomplete reminders that are overdue or due today, as in Reminders' Today
  // list, plus any just ticked that are still fading out.
  async loadReminders() {
    if (this.opts.reminders === 'off') return;
    try {
      const outs = await Promise.all([remindctl('show', 'overdue'), remindctl('show', 'today')]);
      if (outs.includes(null)) return;
      // A reminder due earlier today can be in both.
      const fetched = [...new Map(outs.flatMap((o) => JSON.parse(o)).map((r) => [r.id, r])).values()];
      const leaving = this.reminders.filter((r) => r.isCompleted && r.leave);
      this.reminders = fetched.filter((r) => !r.isCompleted && !leaving.some((x) => x.id === r.id))
        .concat(leaving)
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
      this.cacheReminders();
    } catch (err) {
      console.warn('Home View: could not read Apple Reminders', err);
      return;
    }
    if (!this.gone) this.renderItems();
  }

  // Tick or untick in Apple Reminders. The line flips at once and flips back
  // if Reminders refuses. A ticked line stays struck through for a moment, so
  // it can still be unticked, then fades out of the list.
  async toggleReminder(r) {
    this.setDone(r, !r.isCompleted);
    try {
      await remindctl('edit', r.id, r.isCompleted ? '--complete' : '--incomplete');
    } catch (err) {
      console.warn('Home View: could not update the reminder', err);
      new Notice(`Could not update "${r.title}" in Reminders.`);
      this.setDone(r, !r.isCompleted);
    }
  }

  // Flip the line where it stands rather than rebuilding the list, so the
  // box and the strike-through animate.
  setDone(r, done) {
    r.isCompleted = done;
    const li = this.itemsEl.querySelector(`[data-id="${r.id}"]`);
    li?.toggleClass('is-done', done);
    li?.setAttr('aria-checked', String(done));
    this.renderSay();
    this.scheduleLeave(r);
    this.cacheReminders();
  }

  // Ticked ones are left out, so a fresh render doesn't bring them back.
  cacheReminders() {
    this.cache.reminders = this.reminders.filter((r) => !r.isCompleted).map(({ leave, ...r }) => r);
  }

  scheduleLeave(r) {
    window.clearTimeout(r.leave);
    if (!r.isCompleted) return;
    r.leave = window.setTimeout(() => {
      if (this.gone) return;
      const remove = () => {
        if (this.gone) return;
        this.reminders = this.reminders.filter((x) => x !== r);
        this.renderItems();
      };
      const li = this.itemsEl.querySelector(`[data-id="${r.id}"]`);
      if (!li || reducedMotion()) return remove();
      // Fade the line, then fold its height to nothing so the lines below
      // slide up instead of jumping. Height can't animate from auto, so pin
      // it to its measured size first.
      li.style.height = `${li.offsetHeight}px`;
      void li.offsetHeight;
      li.addClass('is-leaving');
      li.style.height = '0px';
      r.leave = window.setTimeout(remove, 480);
    }, 600);
  }

  renderItems() {
    const el = this.itemsEl;
    el.empty();
    const items = this.files();
    const reminders = this.reminders;
    this.sayEl = el.createEl('p', 'hv-say');
    this.renderSay(items);
    if (!items.length && !reminders.length) return;

    // A plain box per todo; clicking anywhere on the line opens the note.
    const list = el.createEl('ul', 'hv-list');
    items.forEach(({ file }) => {
      const li = list.createEl('li', { attr: { role: 'link', tabindex: '0' } });
      li.createSpan({ cls: 'hv-box', attr: { 'aria-hidden': 'true' } });
      const body = li.createSpan('hv-item');
      body.createSpan({ cls: 'hv-note', text: file.extension === 'md' ? file.basename : file.name });
      const open = (e) => this.app.workspace.openLinkText(file.path, this.sourcePath, Keymap.isModEvent(e));
      li.addEventListener('click', open);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e); });
    });
    // A round box per reminder, as in Reminders; clicking the line ticks it.
    reminders.forEach((r) => {
      const li = list.createEl('li', {
        cls: r.isCompleted ? 'hv-reminder is-done' : 'hv-reminder',
        attr: { role: 'checkbox', tabindex: '0', 'aria-checked': String(!!r.isCompleted), 'data-id': r.id },
      });
      li.createSpan({ cls: 'hv-box', attr: { 'aria-hidden': 'true' } });
      const body = li.createSpan('hv-item');
      body.createSpan({ cls: 'hv-note', text: r.title });
      const due = dueLabel(r.dueDate, new Date());
      if (due) body.createSpan({ cls: due.overdue ? 'hv-due is-overdue' : 'hv-due', text: due.text });
      li.addEventListener('click', () => this.toggleReminder(r));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggleReminder(r); } });
    });
  }

  // The sentence above the list. Ticking a reminder redraws only this.
  renderSay(items = this.files()) {
    const p = this.sayEl;
    p.empty();
    const left = this.reminders.filter((r) => !r.isCompleted).length;
    // Only the counts above zero are said. With both, each gets its own line.
    const parts = [[items.length, 'action item'], [left, 'reminder']].filter(([n]) => n);
    if (!parts.length) {
      p.createSpan({ cls: 'hv-key', text: 'Congratulations' });
      p.appendText(', you are all clear for today.');
      return;
    }
    const split = parts.length > 1;
    p.appendText('You have');
    parts.forEach(([n, word], i) => {
      if (split) p.createEl('br'); else p.appendText(' ');
      p.createSpan({ cls: 'hv-key hv-num', text: String(n) });
      p.appendText(` ${plural(n, word)}${i < parts.length - 1 ? ',' : '.'}`);
    });
  }
}

module.exports = class HomeViewPlugin extends Plugin {
  onload() {
    this.cache = { reminders: [], events: null, calendars: '' };
    this.registerMarkdownCodeBlockProcessor('home-view', (source, el, ctx) => {
      ctx.addChild(new HomeView(this, el, parseOptions(source), ctx.sourcePath));
    });
  }
};
