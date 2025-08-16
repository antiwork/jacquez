import { jsonrepair } from 'jsonrepair'

export interface AIResponse {
  comment_needed: boolean
  comment: string
  reasoning: string
}

export function parseAIResponse(aiResponse: string): AIResponse {
  try {
    const fullJsonResponse = "{" + aiResponse
    const parsedResponse = JSON.parse(fullJsonResponse)
    
    return {
      comment_needed: parsedResponse.comment_needed || false,
      comment: parsedResponse.comment || "",
      reasoning: parsedResponse.reasoning || "",
    }
  } catch (parseError) {
    try {
      const fullJsonResponse = "{" + aiResponse
      const repairedJson = jsonrepair(fullJsonResponse)
      const parsedResponse = JSON.parse(repairedJson)
      
      if (parsedResponse.hasOwnProperty('comment_needed') || 
          parsedResponse.hasOwnProperty('comment') || 
          parsedResponse.hasOwnProperty('reasoning')) {
        return {
          comment_needed: parsedResponse.comment_needed || false,
          comment: parsedResponse.comment || "",
          reasoning: parsedResponse.reasoning || "Repaired from malformed JSON response",
        }
      } else {
        return {
          comment_needed: false,
          comment: "",
          reasoning: "Failed to parse JSON response, skipping comment to avoid posting malformed content",
        }
      }
    } catch (repairError) {
      return {
        comment_needed: false,
        comment: "",
        reasoning: "Failed to parse JSON response, skipping comment to avoid posting malformed content",
      }
    }
  }
}
