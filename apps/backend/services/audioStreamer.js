/**
 * Audio Streamer Service
 * Handles background audio streaming for Jitsi video rooms
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const axios = require('axios');

class AudioStreamer {
  constructor() {
    this.audioDir = path.join(__dirname, '../../public/audio');
    this.currentTrack = null;
    this.isPlaying = false;
    this.ensureAudioDir();
  }

  /**
   * Ensure audio directory exists
   */
  ensureAudioDir() {
    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
      logger.info('Audio directory created', { path: this.audioDir });
    }
  }

  /**
   * Download audio from SoundCloud URL
   * @param {string} soundcloudUrl - SoundCloud share link
   * @param {string} trackName - Name of the track
   * @returns {Promise<string>} - Path to downloaded audio file
   */
  async downloadFromSoundCloud(soundcloudUrl, trackName) {
    try {
      logger.info('Starting SoundCloud download', { url: soundcloudUrl, trackName });

      // Use youtube-dl or yt-dlp to download from SoundCloud
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execPromise = promisify(exec);

      const audioPath = path.join(this.audioDir, `${trackName}.mp3`);
      const command = `yt-dlp -x --audio-format mp3 -o "${audioPath}" "${soundcloudUrl}" 2>&1`;

      logger.debug('Executing download command', { command });
      const { stdout, stderr } = await execPromise(command);

      if (fs.existsSync(audioPath)) {
        logger.info('SoundCloud track downloaded successfully', {
          trackName,
          path: audioPath,
          size: fs.statSync(audioPath).size
        });
        return audioPath;
      } else {
        throw new Error('Download failed - file not created');
      }
    } catch (error) {
      logger.error('Failed to download SoundCloud track', {
        error: error.message,
        soundcloudUrl,
        trackName
      });
      throw error;
    }
  }

  /**
   * Convert audio file to streaming format
   * @param {string} audioPath - Path to audio file
   * @returns {Promise<string>} - Path to converted file
   */
  async convertAudioFormat(audioPath) {
    try {
      if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
      }

      const ext = path.extname(audioPath);
      if (ext.toLowerCase() === '.mp3') {
        logger.debug('Audio already in MP3 format, skipping conversion');
        return audioPath;
      }

      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execPromise = promisify(exec);

      const convertedPath = audioPath.replace(ext, '.mp3');
      const command = `ffmpeg -i "${audioPath}" -q:a 0 -map a "${convertedPath}" 2>&1`;

      logger.debug('Converting audio format', { command });
      await execPromise(command);

      logger.info('Audio converted successfully', {
        original: audioPath,
        converted: convertedPath
      });

      // Delete original if different
      if (convertedPath !== audioPath && fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }

      return convertedPath;
    } catch (error) {
      logger.error('Failed to convert audio', {
        error: error.message,
        audioPath
      });
      throw error;
    }
  }

  /**
   * Set background audio for Jitsi room
   * @param {string} soundcloudUrl - SoundCloud link
   * @param {string} trackName - Track name (for file naming)
   * @returns {Promise<object>} - Audio configuration
   */
  async setupBackgroundAudio(soundcloudUrl, trackName = 'background-music') {
    try {
      logger.info('Setting up background audio', { soundcloudUrl, trackName });

      // Download the track
      const audioPath = await this.downloadFromSoundCloud(soundcloudUrl, trackName);

      // Convert to MP3
      const convertedPath = await this.convertAudioFormat(audioPath);

      // Get file info
      const fileStats = fs.statSync(convertedPath);
      const relativePath = `/audio/${path.basename(convertedPath)}`;

      this.currentTrack = {
        name: trackName,
        path: convertedPath,
        url: relativePath,
        size: fileStats.size,
        createdAt: new Date(),
        isPlaying: true
      };

      logger.info('Background audio setup complete', {
        trackName,
        fileSize: fileStats.size,
        streamUrl: relativePath
      });

      return {
        success: true,
        trackName,
        streamUrl: relativePath,
        fileSize: fileStats.size,
        jitsiConfig: this.getJitsiAudioConfig(relativePath)
      };
    } catch (error) {
      logger.error('Failed to setup background audio', {
        error: error.message,
        soundcloudUrl,
        trackName
      });
      throw error;
    }
  }

  /**
   * Get Jitsi configuration for audio streaming
   * @param {string} audioUrl - URL to audio file
   * @returns {object} - Jitsi config
   */
  getJitsiAudioConfig(audioUrl) {
    return {
      audio: {
        backgroundAudio: true,
        audioSource: audioUrl
      },
      jitsi: {
        configOverwrite: {
          startAudioMuted: false,
          startVideoMuted: false,
          backgroundAudio: {
            enabled: true,
            url: audioUrl,
            autoplay: true,
            loop: true,
            volume: 0.3
          }
        },
        interfaceConfigOverwrite: {
          TOOLBAR_BUTTONS: [
            'microphone',
            'camera',
            'desktop',
            'fullscreen',
            'foyer',
            'settings',
            'raisehand',
            'videobackgroundblur',
            'download',
            'feedback',
            'stats',
            'shortcuts',
            'recording',
            'livestreaming',
            'etherpad',
            'sharedvideo',
            'settings',
            'profile',
            'invite',
            'participants-pane',
            'chat',
            'polls'
          ]
        }
      }
    };
  }

  /**
   * Stop background audio
   */
  stopBackgroundAudio() {
    if (this.currentTrack) {
      this.currentTrack.isPlaying = false;
      logger.info('Background audio stopped', { trackName: this.currentTrack.name });
    }
  }

  /**
   * Get current audio track info
   */
  getCurrentTrack() {
    return this.currentTrack;
  }

  /**
   * List all available audio files
   */
  listAudioFiles() {
    try {
      const files = fs.readdirSync(this.audioDir);
      const audioFiles = files.filter(f => ['.mp3', '.wav', '.m4a'].includes(path.extname(f)));

      return audioFiles.map(file => ({
        name: path.basename(file, path.extname(file)),
        file: file,
        url: `/audio/${file}`,
        size: fs.statSync(path.join(this.audioDir, file)).size,
        path: path.join(this.audioDir, file)
      }));
    } catch (error) {
      logger.error('Failed to list audio files', { error: error.message });
      return [];
    }
  }

  /**
   * Delete audio file
   */
  deleteAudioFile(filename) {
    try {
      const filePath = path.join(this.audioDir, filename);

      if (!filePath.startsWith(this.audioDir)) {
        throw new Error('Invalid file path');
      }

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info('Audio file deleted', { filename });
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Failed to delete audio file', { error: error.message, filename });
      throw error;
    }
  }
}

module.exports = new AudioStreamer();
