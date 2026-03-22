import axios from 'axios';
import { BUFFER_API_KEY_URL, BUFFER_DEVELOPER_DOCS_URL, HTTP_TIMEOUT_MS } from './constants.js';

const GET_PROFILES_QUERY = `
  query GetChannels {
    account {
      organizations {
        id
        channels {
          id
          service
        }
      }
    }
  }
`;

const CREATE_POST_MUTATION = `
  mutation CreatePost($text: String!, $channelId: ID!, $schedulingType: SchedulingType!, $mode: SharingMode!, $dueAt: DateTime) {
    createPost(input: {
      text: $text
      channelId: $channelId
      schedulingType: $schedulingType
      mode: $mode
      dueAt: $dueAt
    }) {
      ... on PostActionSuccess {
        post {
          id
          text
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

const GET_SCHEDULED_POSTS_QUERY = `
  query GetScheduledPosts($profileId: ID) {
    scheduledPosts(profileId: $profileId) {
      id
      text
      scheduledAt
      profiles {
        service
        username
      }
    }
  }
`;

const CREATE_IDEA_MUTATION = `
  mutation CreateIdea($input: CreateIdeaInput!) {
    createIdea(input: $input) {
      id
      text
    }
  }
`;

const GET_IDEAS_QUERY = `
  query GetIdeas {
    ideas {
      id
      text
      createdAt
    }
  }
`;

/**
 * Build a multi-line actionable error message.
 * @param {string} whatFailed
 * @param {string} reason
 * @param {string[]} fixes
 * @returns {string}
 */
function formatActionableError(whatFailed, reason, fixes) {
  return [
    `Failed: ${whatFailed}`,
    `Reason: ${reason}`,
    'Fix:',
    ...fixes.map((fix, index) => `${index + 1}. ${fix}`),
  ].join('\n');
}

export class BufferApi {
  /**
   * @param {{apiKey: string, apiUrl: string}} config
   * @param {import('axios').AxiosInstance} [httpClient]
   */
  constructor(config, httpClient) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl;
    this.http =
      httpClient ||
      axios.create({
        baseURL: this.apiUrl,
        timeout: HTTP_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
  }

  /**
   * Execute a GraphQL operation.
   * @param {string} query
   * @param {Record<string, any>} [variables]
   * @returns {Promise<Record<string, any>>}
   */
  async gql(query, variables = {}) {
    try {
      const { data } = await this.http.post('', { query, variables });

      if (data.errors?.length) {
        const first = data.errors[0];
        throw new Error(
          formatActionableError('Buffer GraphQL request', first.message, [
            'Verify your input values (profile IDs, date format, and required fields).',
            `Check Buffer API docs: ${BUFFER_DEVELOPER_DOCS_URL}`,
          ])
        );
      }

      return data.data;
    } catch (error) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        throw new Error(
          formatActionableError(`Buffer API request (${status})`, 'Authentication failed', [
            'Check BUFFER_API_KEY in .env.',
            `Generate a new key at ${BUFFER_API_KEY_URL} if needed.`,
            'Retry the command after updating your key.',
          ])
        );
      }

      if (status === 429) {
        throw new Error(
          formatActionableError('Buffer API request (429)', 'Rate limit exceeded', [
            'Wait about 60 seconds before retrying.',
            'Reduce request bursts when scripting multiple commands.',
          ])
        );
      }

      if (status) {
        throw new Error(
          formatActionableError(`Buffer API request (${status})`, error.message, [
            'Retry in a moment in case the API is temporarily unavailable.',
            'If this keeps happening, check Buffer status/docs for incident details.',
          ])
        );
      }

      throw new Error(
        formatActionableError('Buffer API network call', error.message, [
          'Check internet connectivity or VPN/proxy settings.',
          'Retry the command. If it times out repeatedly, increase network stability.',
        ])
      );
    }
  }

  /**
   * Fetch all connected Buffer channels.
   * @returns {Promise<Array<{id: string, service: string}>>}
   */
  async getProfiles() {
    const data = await this.gql(GET_PROFILES_QUERY);
    // Extract channels from nested structure
    const channels = [];
    if (data.account?.organizations) {
      for (const org of data.account.organizations) {
        if (org.channels) {
          channels.push(...org.channels);
        }
      }
    }
    return channels;
  }

  /**
   * @param {{text: string, channelId: string, scheduledAt?: string, queue?: boolean, now?: boolean, draft?: boolean, imageUrl?: string, service?: string}} input
   */
  async createPost(input) {
    // Determine mode based on options
    const mode = input.now ? 'shareNow' : (input.queue ? 'addToQueue' : 'customScheduled');
    const dueAtLine = input.scheduledAt ? `dueAt: "${input.scheduledAt}"` : '';
    const draftLine = input.draft ? 'saveToDraft: true' : '';
    
    // Platform-specific metadata (required for Facebook/Instagram)
    let metadataLine = '';
    const service = (input.service || '').toLowerCase();
    if (service === 'facebook') {
      metadataLine = 'metadata: { facebook: { type: post } }';
    } else if (service === 'instagram') {
      metadataLine = 'metadata: { instagram: { type: post, shouldShareToFeed: true } }';
    }
    
    // Image assets (must be a URL, not local file)
    const assetsLine = input.imageUrl ? `assets: { images: [{ url: "${input.imageUrl}" }] }` : '';
    
    const mutation = `
      mutation CreatePost($text: String!, $channelId: ChannelId!) {
        createPost(input: {
          text: $text
          channelId: $channelId
          schedulingType: automatic
          mode: ${mode}
          ${dueAtLine}
          ${draftLine}
          ${metadataLine}
          ${assetsLine}
        }) {
          ... on PostActionSuccess {
            post {
              id
              text
            }
          }
          __typename
        }
      }
    `;
    
    const variables = {
      text: input.text,
      channelId: input.channelId
    };
    
    const data = await this.gql(mutation, variables);
    const result = data.createPost;
    
    // Handle union type response
    if (result.__typename !== 'PostActionSuccess' || !result.post) {
      throw new Error(
        formatActionableError('Buffer post creation', `Unexpected response: ${JSON.stringify(result)}`, [
          'Check that your channel ID is correct.',
          'Verify your post text meets Buffer requirements.',
          'Try a different scheduling option or time.'
        ])
      );
    }
    
    return result.post;
  }

  /**
   * Delete a post by ID.
   * @param {string} postId
   * @returns {Promise<boolean>}
   */
  async deletePost(postId) {
    const mutation = `
      mutation DeletePost {
        deletePost(input: { id: "${postId}" }) {
          ... on DeletePostSuccess { __typename }
          ... on VoidMutationError { message }
        }
      }
    `;
    const data = await this.gql(mutation);
    const result = data.deletePost;
    if (result.__typename === 'DeletePostSuccess') return true;
    if (result.message) throw new Error(result.message);
    return false;
  }

  /**
   * List posts by status (draft, pending, sent).
   * @param {string} orgId
   * @param {string[]} statuses
   * @returns {Promise<Array>}
   */
  async listPosts(orgId, statuses = ['draft']) {
    const statusList = statuses.map(s => s).join(', ');
    const query = `
      { posts(input: { organizationId: "${orgId}", filter: { status: [${statusList}] } }, first: 50) {
        edges { node { id text status channelId } }
      }}
    `;
    const data = await this.gql(query);
    return (data.posts?.edges || []).map(e => e.node);
  }

  /**
   * @param {string | undefined} profileId
   */
  async getScheduledPosts(profileId) {
    const data = await this.gql(GET_SCHEDULED_POSTS_QUERY, { profileId });
    return data.scheduledPosts || [];
  }

  /**
   * @param {{text: string, profileIds?: string[]}} input
   */
  async createIdea(input) {
    const data = await this.gql(CREATE_IDEA_MUTATION, { input });
    return data.createIdea;
  }

  /**
   * Fetch saved ideas/drafts.
   * @returns {Promise<Array<{id: string, text: string, createdAt?: string}>>}
   */
  async getIdeas() {
    const data = await this.gql(GET_IDEAS_QUERY);
    return data.ideas || [];
  }
}

export {
  GET_PROFILES_QUERY,
  CREATE_POST_MUTATION,
  GET_SCHEDULED_POSTS_QUERY,
  CREATE_IDEA_MUTATION,
  GET_IDEAS_QUERY,
};
