import { AddonDetail, ParsedNameData, StreamRequest } from '@aiostreams/types';
import { parseFilename, extractSizeInBytes } from '@aiostreams/parser';
import { ParsedStream, Stream, Config } from '@aiostreams/types';
import { BaseWrapper } from './base';
import { addonDetails } from './details';


export class MediaFusion extends BaseWrapper {
  constructor(configString: string | null, overrideUrl: string | null, indexerTimeout: number = 10000, addonName: string = 'MediaFusion') {
    let url = overrideUrl
      ? overrideUrl
      : 'https://mediafusion.elfhosted.com/' +
        (configString ? configString + '/' : '');

    super(addonName, url, indexerTimeout);
  }

  protected parseStream(stream: Stream): ParsedStream {
    const filename = stream.behaviorHints?.filename?.trim() ||
      stream.description?.split('\n')[0].replace("📂 ", "");
    
    const parsedFilename: ParsedNameData = parseFilename(filename || stream.behaviorHints?.bingeGroup || stream.description || '');
    const sizeInBytes = stream.behaviorHints?.videoSize  
      ? stream.behaviorHints.videoSize
      : stream.description
      ? extractSizeInBytes(stream.description, 1024)
      : undefined;

    const nameParts = stream.name!.split(' ');
    const provider = nameParts[nameParts.length - 3];
    const emoji = nameParts[nameParts.length - 1];

    const debrid = provider !== 'P2P' && (emoji === '⏳' || emoji === '⚡️')
      ? {
          provider,
          cached: emoji === '⚡️',
        }
      : undefined;

    const indexerMatch = RegExp(/🔗 ([a-zA-Z0-9]+)/).exec(stream.description || '');
    const indexer = indexerMatch ? indexerMatch[1] : undefined;

    const seedersMatch = RegExp(/👤 (\d+)/).exec(stream.description || '');
    const seeders = seedersMatch ? parseInt(seedersMatch[1]) : undefined;

    return {
      ...parsedFilename,
      filename,
      size: sizeInBytes,
      addonName: this.addonName,
      url: stream.url,
      externalUrl: stream.externalUrl,
      indexers: indexer,
      provider: debrid
        ? {
            name: debrid.provider,
            cached: debrid.cached,
          }
        : undefined,
      torrent: {
        infoHash: stream.infoHash,
        fileIdx: stream.fileIdx,
        sources: stream.sources,
        seeders: seeders
      },
      stream: {
        behaviorHints: {
          notWebReady: stream.behaviorHints?.notWebReady,
        }
      }
    
    };
  }
}

export async function getMediafusionStreams(
  config: Config,
  mediafusionOptions: {
    prioritiseDebrid?: string;
    overrideUrl?: string;
    indexerTimeout?: string;
    overrideName?: string;
  },
  streamRequest: StreamRequest
): Promise<ParsedStream[]> {
  const supportedServices: string[] = addonDetails.find((addon: AddonDetail) => addon.id === 'mediafusion')?.supportedServices || [];
  const parsedStreams: ParsedStream[] = [];
  const indexerTimeout = mediafusionOptions.indexerTimeout ? parseInt(mediafusionOptions.indexerTimeout) : undefined;

  // If overrideUrl is provided, use it to get streams and skip all other steps
  if (mediafusionOptions.overrideUrl) {
    const mediafusion = new MediaFusion(null, mediafusionOptions.overrideUrl as string, indexerTimeout, mediafusionOptions.overrideName);
    return mediafusion.getParsedStreams(streamRequest);
  }

  // find all usable services
  const usableServices = config.services.filter((service) =>
    supportedServices.includes(service.id)
  );

  // if no usable services found, use mediafusion without debrid
  if (usableServices.length < 0) {
    const configString = await getConfigString('https://mediafusion.elfhosted.com/', getMediaFusionConfig());
    const mediafusion = new MediaFusion(configString, null, indexerTimeout, mediafusionOptions.overrideName);
    return mediafusion.getParsedStreams(streamRequest);
  }


  // otherwise, depending on the configuration, create multiple instances of mediafusion or use a single instance with the prioritised service

  if (mediafusionOptions.prioritiseDebrid && !supportedServices.includes(mediafusionOptions.prioritiseDebrid)) {
    throw new Error('Invalid debrid service');
  }

  if (mediafusionOptions.prioritiseDebrid) {
      const debridService = usableServices.find(
      (service) => service.id === mediafusionOptions.prioritiseDebrid
      );
      if (!debridService) {
      throw new Error('Debrid service not found for ' + mediafusionOptions.prioritiseDebrid);
      }
      if (!debridService.credentials.apiKey) {
      throw new Error('Debrid service API key not found for ' + mediafusionOptions.prioritiseDebrid);
      }

      // get the encrypted mediafusion string
      const mediafusionConfig = getMediaFusionConfig(debridService.id, debridService.credentials.apiKey);
      const encryptedStr = await getConfigString('https://mediafusion.elfhosted.com/', mediafusionConfig);
      const mediafusion = new MediaFusion(encryptedStr, null, indexerTimeout, mediafusionOptions.overrideName);

      return mediafusion.getParsedStreams(streamRequest);
  }

  // if no prioritised service is provided, create a mediafusion instance for each service
  const servicesToUse = usableServices.filter((service) => service.enabled);
  if (servicesToUse.length < 1) {
    throw new Error('No supported service(s) enabled');
  }
  for (const service of servicesToUse) {
    const mediafusionConfig = getMediaFusionConfig(service.id, service.credentials.apiKey);
    const encryptedStr = await getConfigString('https://mediafusion.elfhosted.com/', mediafusionConfig);
    const mediafusion = new MediaFusion(encryptedStr, null, indexerTimeout, mediafusionOptions.overrideName);
    const streams = await mediafusion.getParsedStreams(streamRequest);
    parsedStreams.push(...streams);
  }

  return parsedStreams;

}





















const getMediaFusionConfig = (service?: string, token?: string) => {
  return {
    streaming_provider: service
      ? {
          token: token,
          service: service,
          enable_watchlists_catalogs: false,
          download_via_browser: false,
          only_show_cached_streams: false,
        }
      : null,
    selected_catalogs: [],
    selected_resolutions: [
      '4k',
      '2160p',
      '1440p',
      '1080p',
      '720p',
      '576p',
      '480p',
      '360p',
      '240p',
      null,
    ],
    enable_catalogs: true,
    enable_imdb_metadata: false,
    max_size: 'inf',
    max_streams_per_resolution: '500',
    torrent_sorting_priority: [
      { key: 'language', direction: 'desc' },
      { key: 'cached', direction: 'desc' },
      { key: 'resolution', direction: 'desc' },
      { key: 'quality', direction: 'desc' },
      { key: 'size', direction: 'desc' },
      { key: 'seeders', direction: 'desc' },
      { key: 'created_at', direction: 'desc' },
    ],
    show_full_torrent_name: true,
    nudity_filter: ['Severe'],
    certification_filter: ['Adults'],
    language_sorting: [
      'English',
      'Tamil',
      'Hindi',
      'Malayalam',
      'Kannada',
      'Telugu',
      'Chinese',
      'Russian',
      'Arabic',
      'Japanese',
      'Korean',
      'Taiwanese',
      'Latino',
      'French',
      'Spanish',
      'Portuguese',
      'Italian',
      'German',
      'Ukrainian',
      'Polish',
      'Czech',
      'Thai',
      'Indonesian',
      'Vietnamese',
      'Dutch',
      'Bengali',
      'Turkish',
      'Greek',
      'Swedish',
      null,
    ],
    quality_filter: [
      'BluRay/UHD',
      'WEB/HD',
      'DVD/TV/SAT',
      'CAM/Screener',
      'Unknown',
    ],
    api_password: null,
    mediaflow_config: null,
    rpdb_config: null,
    live_search_streams: false,
    contribution_streams: false,
  };
};

async function getConfigString(
  baseUrl: string = 'https://mediafusion.elfhosted.com/',
  data: any
): Promise<string> {
  const encryptUrl = `${baseUrl}encrypt-user-data`;

  const response = await fetch(encryptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  const encryptedData = await response.json();
  if (encryptedData.status !== 'success') {
    throw new Error('Failed to encrypt data for mediafusion' + encryptedData.message);
  }

  return encryptedData.encrypted_str;
}
