// Practice content. All text is original to this app; technique descriptions follow the
// project books (Fraser, "Self-Therapy for the Stutterer"; Ward, "Stuttering and Cluttering";
// Hausman, "How to Develop a Powerful, Clear and Resonant Speaking Voice"; the vocology guide).

export const WARMUP_STEPS = [
  { title: 'Yawn-sigh', text: 'Begin a wide, easy yawn, then let the breath out as a soft falling "haaa". Throat open, no push. Five times.' },
  { title: 'Hum', text: 'Lips closed, hum "mmm" on an easy note. Feel the buzz around the lips and nose, not in the throat. Five long hums.' },
  { title: 'Pitch glides', text: 'On "ooo", slide slowly from a comfortable low note up to a middle note and back down. Never press at the bottom.' },
  { title: 'Straw voice', text: 'Hum through a straw, or through lips rounded as if around one. Keep the air stream steady for a whole breath.' },
  { title: 'Hum into words', text: 'Hum, then open into "mmm-may, mmm-more, mmm-my". Keep the same forward buzz as the hum.' },
];

// Syllable breaks are marked with a middle dot (·) so the karaoke pacer can move one beat per
// syllable. The dots are never shown; the app strips them when it displays the text.
export const PHRASES = [
  'Good morn·ing to you.',
  'I am tak·ing my time.',
  'Ea·sy air, then ea·sy voice.',
  'One phrase on one breath.',
  'My name is my own to say.',
  'I would like a cup of tea.',
  'Let me think a·bout that for a mo·ment.',
  'The meet·ing be·gins at e·lev·en.',
  'Could you say that once more, please?',
  'I will start soft·ly and keep the sound mov·ing.',
  'There is room for ev·ery word I want to say.',
  'We can go o·ver the plan a·gain on Mon·day morn·ing.',
  'I am hap·py to ex·plain how the num·bers were worked out.',
  'Slow air in, low and wide, and the voice rides out on it.',
];

export const READING_PASSAGES = [
  [
    'The road out of the vil·lage ran a·long a low stone wall.',
    'Ear·ly in the morn·ing, the air was still and a lit·tle cool.',
    'A man with a yel·low lamp was o·pen·ing the ba·ker·y door.',
    'Warm bread was al·read·y lined up on the wood·en shelves.',
    'He nod·ded to me, and I nod·ded back, in no hur·ry at all.',
    'Fur·ther a·long, a riv·er moved slow·ly un·der an old i·ron bridge.',
    'Two her·ons were stand·ing in the shal·low wa·ter near the reeds.',
    'I leaned on the rail and watched them for a long while.',
    'No·bod·y was wait·ing for me, and noth·ing need·ed to be said quick·ly.',
    'When I was read·y, I walked on, one ea·sy step af·ter an·oth·er.',
  ],
  [
    'Ev·ery gar·den be·gins with a small and or·di·nar·y de·ci·sion.',
    'You choose a cor·ner, you turn the soil, and you wait.',
    'In the first week, noth·ing seems to be hap·pen·ing at all.',
    'Un·der the ground, how·ev·er, the real work is al·read·y go·ing on.',
    'Roots are mov·ing down and out, slow·ly, a lit·tle more each day.',
    'One morn·ing, a thin green line ap·pears a·bove the dark earth.',
    'It is ea·sy to miss, and it will not be hur·ried a·long.',
    'Wa·ter it, give it light, and leave it room to grow.',
    'By the end of sum·mer, the whole cor·ner is a·live with leaves.',
    'All of it grew from one small de·ci·sion, and from man·y qui·et days.',
  ],
  [
    'A good meet·ing has a be·gin·ning, a mid·dle and a clear end·ing.',
    'Be·fore we be·gin, let me out·line what we need to de·cide to·day.',
    'There are three i·tems, and we will move through them in or·der.',
    'The first is the time·line for the au·tumn de·liv·er·y.',
    'The sec·ond is the budg·et, and where we are a·gainst the plan.',
    'The third is who will own each of the re·main·ing ac·tions.',
    'I will go through the num·bers slow·ly, so ev·ery·one can fol·low.',
    'If an·y·thing is un·clear, please stop me and I will go o·ver it a·gain.',
    'We have e·nough time, and no one needs to rush an an·swer.',
    'When we are done, I will sum up and we will a·gree the next steps.',
  ],
  [
    'Learn·ing an·y skill is most·ly a mat·ter of re·turn·ing to it.',
    'A run·ner does not be·come strong in a sin·gle long af·ter·noon.',
    'She goes out a·gain and a·gain, in all kinds of weath·er.',
    'Some days her legs are heav·y and the miles feel ver·y long.',
    'Those days count as much as the ea·sy ones, and may·be more.',
    'A voice is trained in the same way, a lit·tle at a time.',
    'You show up, you breathe, and you be·gin the sound gent·ly.',
    'On a hard day, you still say what you came to say.',
    'Noth·ing is lost when a ses·sion goes bad·ly, and some·thing is al·ways gained.',
    'O·ver man·y weeks, the ea·sy way of speak·ing be·comes your own.',
  ],
];

export const MONOLOGUES = [
  'You are opening a team meeting. Welcome everyone, say what the meeting is for, and walk through three agenda items.',
  'You are presenting last month\'s results. Explain what went well, what did not, and what you propose to change.',
  'You are introducing yourself to a new group: who you are, what you work on, and what you would like from them.',
  'You are explaining a decision you made to someone who disagrees. Give your reasons one at a time, calmly.',
  'You are giving a short update to a senior manager: where the project stands, the main risk, and what you need.',
];

export const PHONE_CALLS = [
  {
    title: 'Booking a table',
    lines: [
      'Good evening, Riverside Kitchen. How can I help?',
      'Certainly. For which day, and what time?',
      'And how many people will that be?',
      'Could I take a name for the booking, please?',
      'Sorry, could you spell that for me?',
      'And a phone number in case we need to reach you?',
      'Any allergies or special requests?',
      'Lovely, that is all booked. Anything else?',
    ],
  },
  {
    title: 'Calling a clinic',
    lines: [
      'Hello, Parkside Clinic, reception speaking.',
      'Is this for a new appointment or a follow-up?',
      'May I have your full name, please?',
      'And your date of birth?',
      'What is the appointment about, briefly?',
      'Which days suit you best this week?',
      'Morning or afternoon?',
      'Can I confirm the best number to call you on?',
    ],
  },
  {
    title: 'A work call',
    lines: [
      'Hi, thanks for calling. Who am I speaking with?',
      'And which team are you with?',
      'What can I do for you today?',
      'Can you give me a bit more detail on that?',
      'When do you need it by?',
      'Who else should be kept in the loop?',
      'Is there anything blocking you right now?',
      'Okay. Could you sum up what we have agreed?',
    ],
  },
];

export const TOPICS = [
  'Describe the route you take most often, as if giving directions to a visitor.',
  'Talk about a meal you know how to cook, step by step.',
  'Describe your work to someone who has never heard of your field.',
  'Talk about a place you would like to go back to, and why.',
  'Explain a game or sport you know well to a beginner.',
  'Talk about something you changed your mind about.',
  'Describe a person who taught you something useful.',
];

export const DRILL_STEPS = [
  {
    title: 'Cancellation',
    text: 'Say a word you often block on and let a block happen, or imitate one. Finish the word. Pause for two full seconds and let the tension go. Then say the same word again slowly, with light contacts. It does not need to be fluent; it needs to be easy. Carry on speaking.',
  },
  {
    title: 'Pull-out',
    text: 'Start a block on purpose and stay in it. Notice exactly where the tension is: lips, tongue or throat. Still holding the sound, loosen that spot slowly and slide out into the rest of the word.',
  },
  {
    title: 'Preparatory set',
    text: 'Pick a word you expect trouble with. Before starting, rest the lips and tongue in an easy position, begin the air first, then bring the voice in gently and stretch the first sound a little.',
  },
];

/** Pick an item that changes from session to session but is stable within one. */
export function rotate(list, sessionNumber) {
  return list[sessionNumber % list.length];
}
