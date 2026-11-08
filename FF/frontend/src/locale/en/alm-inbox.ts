// English display copy; canonical IDs and user text are preserved.
export default {
  "almInbox.rejudgeDetail": (title: string, from: number, to: number, released: boolean) => `${title} v${from} → v${to}${released ? ' · Released version' : ''}`,
  "almInbox.conflictField": (field: string) => field === 'status' ? 'Status' : (({country:'Country',vehicleModel:'Vehicle model',trim:'Trim',asil:'ASIL',ownerId:'Owner team',featureDb:'Feature DB reference Feature',featureId:'Feature ID',workingVersion:'Working version',releaseVersion:'Release version',gates:'Gates',workProducts:'Work product completion',ffLink:'Feature Platform link'} as Record<string,string>)[field] ?? field),
};
