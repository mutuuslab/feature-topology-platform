export default {
  "mapScope.note": (country: string, model: string) => `Showing only vehicles matching ${[country && `country ${country}`, model && `model ${model}`].filter(Boolean).join(' · ')}.`,
  "mapScope.clear": 'View all vehicles',
};
