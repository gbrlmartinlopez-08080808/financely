// Facts of the day. Curated by hand and checked against the Wikipedia article each one points to (shown as its source).
// They live inside the app, so the fact of the day costs nothing, works offline, and never fails.
export interface Fact {
  text: string;
  /** the Wikipedia article that backs it up */
  wiki: string;
  topic: string;
}

export const FACTS: Fact[] = [
  { text: 'Octopuses have three hearts and blue blood. Two hearts serve the gills; the third feeds the rest of the body.', wiki: 'Octopus', topic: 'nature' },
  { text: 'A day on Venus is longer than its year: it turns once in about 243 Earth days but circles the Sun in about 225.', wiki: 'Venus', topic: 'space' },
  { text: 'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid of Giza.', wiki: 'Cleopatra', topic: 'history' },
  { text: 'Bananas are berries, in the botanist’s sense. Strawberries are not.', wiki: 'Berry (botany)', topic: 'nature' },
  { text: 'Sharks are older than trees. They have swum for more than 400 million years; the first trees came later.', wiki: 'Shark', topic: 'nature' },
  { text: 'The University of Oxford was teaching before the Aztec Empire existed. Teaching there goes back to 1096; Tenochtitlan was founded in 1325.', wiki: 'University of Oxford', topic: 'history' },
  { text: 'The Eiffel Tower can be about 15 centimetres taller in summer: the iron expands in the heat.', wiki: 'Eiffel Tower', topic: 'places' },
  { text: 'The shortest war in history, the Anglo-Zanzibar War of 1896, ended in under an hour.', wiki: 'Anglo-Zanzibar War', topic: 'history' },
  { text: 'There are more trees on Earth than stars in the Milky Way: roughly three trillion trees against a few hundred billion stars.', wiki: 'Tree', topic: 'nature' },
  { text: 'The Great Wall of China cannot be seen from the Moon, and is very hard to pick out from low orbit with the naked eye.', wiki: 'Great Wall of China', topic: 'places' },
  { text: 'Sunlight takes about eight minutes and twenty seconds to reach Earth.', wiki: 'Sun', topic: 'space' },
  { text: 'Antarctica is the largest desert on Earth. A desert is defined by how little falls from the sky, not by heat.', wiki: 'Desert', topic: 'places' },
  { text: 'Lake Baikal in Siberia is the deepest lake in the world, at about 1,640 metres, and holds around a fifth of the planet’s unfrozen fresh surface water.', wiki: 'Lake Baikal', topic: 'places' },
  { text: 'Crows can learn to recognise individual human faces, and they remember who treated them badly.', wiki: 'American crow', topic: 'nature' },
  { text: 'Ada Lovelace published what is often called the first computer program in 1843, for a machine that had not yet been built.', wiki: 'Ada Lovelace', topic: 'science' },
  { text: 'The shore of the Dead Sea is the lowest dry land on Earth, about 430 metres below sea level.', wiki: 'Dead Sea', topic: 'places' },
  { text: 'Jellyfish have no brain, no heart and no bones, and have drifted through the oceans for hundreds of millions of years.', wiki: 'Jellyfish', topic: 'nature' },
  { text: 'Tardigrades, tiny animals less than a millimetre long, can survive the vacuum of space.', wiki: 'Tardigrade', topic: 'science' },
  { text: 'The Pacific Ocean is larger than all of Earth’s land put together.', wiki: 'Pacific Ocean', topic: 'places' },
  { text: 'Sea otters sometimes hold hands while they sleep, so they do not drift apart.', wiki: 'Sea otter', topic: 'nature' },
  { text: 'Saturn is less dense than water. If there were a bathtub big enough, it would float.', wiki: 'Saturn', topic: 'space' },
  { text: 'The word “robot” comes from the Czech word for forced labour. It was introduced by Karel Čapek’s 1920 play R.U.R.', wiki: 'Robot', topic: 'language' },
  { text: 'Honeybees tell each other where to find flowers by dancing: the angle and length of the “waggle dance” give direction and distance.', wiki: 'Waggle dance', topic: 'nature' },
  { text: 'The summit of Chimborazo in Ecuador is the point on Earth’s surface farthest from the planet’s centre, because Earth bulges at the equator.', wiki: 'Chimborazo', topic: 'places' },
  { text: 'Paper money was first used in China, centuries before it appeared in Europe.', wiki: 'Banknote', topic: 'history' },
  { text: 'A coffee “bean” is really a seed, taken from the fruit of the coffee plant.', wiki: 'Coffea', topic: 'nature' },
  { text: 'Sound travels about four times faster in water than in air.', wiki: 'Speed of sound', topic: 'science' },
  { text: 'Hummingbirds are the only birds that can fly backwards.', wiki: 'Hummingbird', topic: 'nature' },
  { text: 'The Moon is moving away from Earth by about 3.8 centimetres every year.', wiki: 'Moon', topic: 'space' },
  { text: 'Dolphins sleep with half their brain at a time, so that one eye stays open and they can keep surfacing to breathe.', wiki: 'Unihemispheric slow-wave sleep', topic: 'nature' },
  { text: 'The oldest surviving photograph taken from nature, “View from the Window at Le Gras”, was made by Nicéphore Niépce around 1826.', wiki: 'View from the Window at Le Gras', topic: 'science' },
  { text: 'Leonardo da Vinci wrote his notebooks in mirror image, from right to left.', wiki: 'Mirror writing', topic: 'history' },
  { text: 'The Atlantic Ocean is getting wider by a few centimetres every year as the plates under it move apart.', wiki: 'Mid-Atlantic Ridge', topic: 'places' },
  { text: 'Measured from its base on the sea floor, Mauna Kea in Hawaii is taller than Mount Everest.', wiki: 'Mauna Kea', topic: 'places' },
  { text: 'The Hundred Years’ War lasted 116 years.', wiki: 'Hundred Years\' War', topic: 'history' },
  { text: 'Mantis shrimp can strike so fast that the water boils around their claws for an instant.', wiki: 'Mantis shrimp', topic: 'nature' },
  { text: 'Koalas have fingerprints so like ours that they have, in theory, confused crime-scene investigators.', wiki: 'Koala', topic: 'nature' },
  { text: 'Some bamboo grows nearly a metre in a single day.', wiki: 'Bamboo', topic: 'nature' },
  { text: 'The Sahara was green not so long ago: around 11,000 to 5,000 years back, rains turned it into grassland with lakes.', wiki: 'African humid period', topic: 'history' },
  { text: 'In the year 79, Mount Vesuvius buried Pompeii under ash and pumice, preserving the town for nearly 1,700 years.', wiki: 'Pompeii', topic: 'history' },
  { text: 'The Colosseum in Rome could hold around fifty thousand spectators.', wiki: 'Colosseum', topic: 'history' },
  { text: 'A pineapple plant takes roughly two years to bring a single fruit to harvest.', wiki: 'Pineapple', topic: 'nature' },
];
