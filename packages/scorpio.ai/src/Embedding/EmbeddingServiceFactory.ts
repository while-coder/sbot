import { CohereEmbeddingService } from "./CohereEmbeddingService";
import { GoogleEmbeddingService } from "./GoogleEmbeddingService";
import { IEmbeddingService } from "./IEmbeddingService";
import { OllamaEmbeddingService } from "./OllamaEmbeddingService";
import { OpenAIEmbeddingService } from "./OpenAIEmbeddingService";
import { VoyageAIEmbeddingService } from "./VoyageAIEmbeddingService";
import { EmbeddingConfig, EmbeddingProvider } from "./types";

export class EmbeddingServiceFactory {
  static async getEmbeddingService(config: EmbeddingConfig): Promise<IEmbeddingService> {
    let service: IEmbeddingService;

    switch (config.provider) {
      case EmbeddingProvider.Ollama:
        service = new OllamaEmbeddingService(config);
        break;
      case EmbeddingProvider.Google:
        service = new GoogleEmbeddingService(config);
        break;
      case EmbeddingProvider.VoyageAI:
        service = new VoyageAIEmbeddingService(config);
        break;
      case EmbeddingProvider.Cohere:
        service = new CohereEmbeddingService(config);
        break;
      default:
        service = new OpenAIEmbeddingService(config);
        break;
    }

    await service.initialize();
    return service;
  }
}
