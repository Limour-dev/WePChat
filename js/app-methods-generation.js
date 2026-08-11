/* WepChat - 消息生成与远程事件 */
'use strict';

(() => {
  const { nextTick, clone, cleanTitle, normalizeSession, newProvider, parseModels, modelsText, imageModelsText, providerModelMeta, tokenMessageText, imageExtForMime, imageFileName, attachmentFileName, fileSafeName, normalizeWorkspacePath, parentFolder, ensureParentFolders, workspaceMime, workspaceExt, isHtmlName, isMarkdownName, isImageName, isJsName, RELEASES_URL, LATEST_RELEASE_API, normalizeAppVersion, appTag, parseReleaseTag, compareReleaseTags, formatReleaseDate, fetchLatestRelease, plusRuntimeVersion, manifestVersion, normalizeStylePreset, isEditableName, languageForName, resolveWorkspaceRef, dataUrlDownload, readPickedFile, escapeScriptEnd, isExternalRef, externalWebUrl, normalizeRef, htmlAttr, TextTargets, TextTimers, TextResolvers, resolveTyping, smoothText, waitSmoothText, streamToolKey, findToolDisplay, syncStreamToolCalls, clearStreamState, finalizeStreamToolCalls, discardStreamToolCalls, cancelStreamToolCalls } = window.WepChatAppHelpers;
  window.WepChatAppMethodsGeneration = {
      settingsForRequest(tools) {
        const s = Object.assign({}, this.settings);
        // 系统提示词仅使用设置里的值；不自动附加内置 Tools.SYSTEM_HINT（去掉系统提示词）
        if (!s.systemPrompt) delete s.systemPrompt;
        return s;
      },
      // 按工具权限过滤，只暴露未禁用（非 never）的工具给模型；默认仅 run_js 开启
      enabledTools() {
        const all = Tools.DEFS || [];
        return all.filter(d => {
          try { return this.toolPermission(d.name) !== 'never'; } catch (e) { return true; }
        });
      },
      apiBaseMessages() {
        return this.session.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => {
            if (m.role === 'assistant') {
              return { role: 'assistant', content: m.content || '', reasoning: m.reasoning || '' };
            }
            return clone(m);
          });
      },
      imageRequestModel(mode) {
        const provider = this.imageProvider;
        let model = this.imageModelId;
        if (mode === 'edit' && this.settings.imageEditModel && this.imageEditModelOptions.includes(this.settings.imageEditModel)) {
          model = this.settings.imageEditModel;
        }
        if (!provider) throw new Error('请先添加图片提供商');
        if (!provider.baseUrl) throw new Error('请先填写图片提供商 API 地址');
        if (!model) throw new Error('请先在图片生成设置中选择模型');
        const imageProvider = Object.assign({}, provider, {
          baseUrl: String(provider.imageBaseUrl || provider.baseUrl || '').trim(),
          apiKey: provider.imageApiKey || provider.apiKey || '',
          imageEndpointPath: String(this.settings.imageEndpointPath || provider.imageEndpointPath || '').trim(),
          imageEditEndpointPath: String(this.settings.imageEditEndpointPath || provider.imageEditEndpointPath || '').trim()
        });
        return { provider: imageProvider, model };
      },
      imagePromptFromArgs(args) {
        const parts = [String(args.prompt || '').trim()];
        const presetId = Object.prototype.hasOwnProperty.call(args, 'stylePresetId')
          ? args.stylePresetId
          : this.settings.imageStylePresetId;
        const preset = this.imageStylePresetById(presetId);
        if (preset) parts.push('风格预设（' + preset.name + '）：' + preset.prompt);
        if (args.style) parts.push('风格：' + args.style);
        return parts.filter(Boolean).join('\n');
      },
      imageReferencesFromArgs(args) {
        const refs = [];
        const names = []
          .concat(args.parentFile ? [args.parentFile] : [])
          .concat(Array.isArray(args.referenceFiles) ? args.referenceFiles : []);
        names.forEach(name => {
          try {
            const path = normalizeWorkspacePath(name);
            const f = this.session.files && this.session.files[path];
            if (f && f.dataUrl) refs.push({ name: path.split('/').pop() || 'reference.png', path, dataUrl: f.dataUrl, mime: f.mime || '' });
          } catch (e) {}
        });
        (args.referenceImages || []).forEach((img, idx) => {
          if (img && img.dataUrl) refs.push({ name: img.name || ('reference_' + (idx + 1) + '.png'), dataUrl: img.dataUrl, mime: img.mime || '' });
        });
        return refs;
      },
      recentImageReferencePaths() {
        const out = [];
        const msgs = (this.session.messages || []).slice().reverse();
        for (const m of msgs) {
          (m.attachments || []).forEach(a => {
            if (a.kind === 'image' && a.path && !out.includes(a.path)) out.push(a.path);
          });
          if (out.length) break;
        }
        return out;
      },
      saveGeneratedImages(images, args, provider, model) {
        const saved = [];
        this.session.files = this.session.files || {};
        (images || []).forEach((img, idx) => {
          if (!img || !img.dataUrl) return;
          if (Object.keys(this.session.files).length >= Tools.MAX_FILES) throw new Error('会话文件数已达上限');
          let path = args.targetFile && images.length === 1 ? args.targetFile : imageFileName(args.prompt, idx, img.mime);
          try { path = normalizeWorkspacePath(path); }
          catch (e) { path = imageFileName(args.prompt, idx, img.mime); }
          if (!isImageName(path)) path += '.' + imageExtForMime(img.mime);
          if (this.session.files[path]) {
            const ext = '.' + imageExtForMime(img.mime);
            path = path.replace(/\.[a-z0-9]+$/i, '') + '_' + U.uuid().slice(0, 4) + ext;
          }
          ensureParentFolders(this.session, path);
          const size = Math.ceil(String(img.dataUrl).length * 0.75);
          this.session.files[path] = {
            dataUrl: img.dataUrl,
            mime: img.mime || 'image/png',
            size,
            mtime: U.now(),
            source: args.source || 'image_mode',
            imageMeta: {
              prompt: args.prompt || '',
              revisedPrompt: img.revisedPrompt || '',
              model,
              providerId: provider.id,
              mode: args.mode || 'generate',
              size: args.size || this.settings.imageDefaultSize || 'auto',
              count: args.count || 1,
              quality: args.quality || this.settings.imageQuality || 'auto',
              background: args.background || this.settings.imageBackground || 'auto',
              outputFormat: args.outputFormat || this.settings.imageOutputFormat || 'png',
              style: args.style || '',
              stylePresetId: args.stylePresetId || '',
              stylePresetName: args.stylePresetName || '',
              referenceFiles: args.referenceFiles || [],
              parentFile: args.parentFile || ''
            }
          };
          saved.push({ path, mime: img.mime || 'image/png', prompt: args.prompt || '' });
        });
        if (saved.length) this.openFolders.images = true;
        return saved;
      },
      generatedImageSrc(img) {
        if (!img) return '';
        return img.dataUrl || (this.session.files && this.session.files[img.path] && this.session.files[img.path].dataUrl) || '';
      },
      async runImageRequest(rawArgs, targetMsg) {
        const args = Object.assign({}, rawArgs || {});
        if (!Object.prototype.hasOwnProperty.call(args, 'stylePresetId')) {
          args.stylePresetId = this.settings.imageStylePresetId || '';
        }
        const preset = this.imageStylePresetById(args.stylePresetId);
        args.stylePresetName = preset ? preset.name : '';
        args.prompt = this.imagePromptFromArgs(args);
        if (!args.prompt) throw new Error('缺少图片提示词');
        args.size = args.size || this.settings.imageDefaultSize || 'auto';
        args.quality = args.quality || this.settings.imageQuality || 'auto';
        args.background = args.background || this.settings.imageBackground || 'auto';
        args.outputFormat = args.outputFormat || this.settings.imageOutputFormat || 'png';
        args.count = U.clamp(parseInt(args.count || 1, 10) || 1, 1, 8);
        const referenceImages = this.imageReferencesFromArgs(args);
        const requestMode = args.mode || (referenceImages.length ? 'edit' : 'generate');
        const { provider, model } = this.imageRequestModel(requestMode);
        const meta = providerModelMeta(provider, model);
        const caps = meta && meta.capabilities || {};
        if (!(caps.imageGeneration || (meta.image && meta.image.generation))) {
          U.toast('当前图片模型元数据未标记生图能力，仍尝试调用接口', 3200);
        }
        if (requestMode === 'edit' && !referenceImages.length) {
          throw new Error('图片编辑需要至少一张参考图');
        }
        let result;
        try {
          result = await ImageAPI.generate({
            provider,
            model,
            prompt: args.prompt,
            mode: requestMode,
            referenceImages,
            size: args.size,
            count: args.count,
            settings: {
              size: args.size,
              count: args.count,
              quality: args.quality,
              background: args.background,
              outputFormat: args.outputFormat,
              apiMode: this.settings.imageApiMode || 'images',
              endpointPath: this.settings.imageEndpointPath || provider.imageEndpointPath || '',
              editsEndpointPath: this.settings.imageEditEndpointPath || provider.imageEditEndpointPath || '',
              imageOnly: !!(caps.imageGeneration || (meta.image && meta.image.generation))
            },
            signal: this.abortCtl && this.abortCtl.signal,
            requestKey: args.requestKey || NetStability.idempotencyKey('image-' + (targetMsg && targetMsg.id || U.uuid())),
            onStatus: info => this.connectionStatus(Object.assign({ source: '图片生成' }, info || {}))
          });
        } catch (e) {
          if (targetMsg && (e && e.resultUrl || e && e.pollUrl)) {
            targetMsg.imageRecovery = {
              resultUrl: e.resultUrl || '',
              pollUrl: e.pollUrl || '',
              providerId: provider.id,
              model,
              format: args.outputFormat || 'png',
              args: Object.assign({}, args)
            };
            this.persistSession();
          }
          if (this.stopRequested || e && e.code === 'NET-ABORTED') throw e;
          throw this.connectionError(e, '图片生成', e && e.code || 'IMAGE-SUBMIT-UNKNOWN');
        }
        const saved = this.saveGeneratedImages(result.images || [], args, provider, model);
        if (!saved.length) throw NetStability.createError('IMAGE-RESULT-MISSING', '接口已返回，但没有可用图片结果');
        this.connectionStatus({ state: 'recovered', source: '图片生成', code: 'IMAGE-READY', message: '图片结果已完整接收并保存' });
        if (targetMsg) {
          targetMsg.images = (targetMsg.images || []).concat(saved);
          targetMsg.content = targetMsg.content || ('已生成 ' + saved.length + ' 张图片，已保存到工作区 images/。');
        }
        this.persistSession();
        return saved;
      },
      async imageGoTool(args, targetMsg) {
        args = Object.assign({}, args || {});
        const refs = []
          .concat(args.parentFile ? [args.parentFile] : [])
          .concat(Array.isArray(args.referenceFiles) ? args.referenceFiles : []);
        if (!refs.length && (args.mode === 'edit' || this.recentImageReferencePaths().length)) {
          args.referenceFiles = this.recentImageReferencePaths();
          if (args.referenceFiles.length) args.mode = 'edit';
        }
        const saved = await this.runImageRequest(Object.assign({}, args, { source: 'image_go' }), targetMsg);
        return '已生成 ' + saved.length + ' 张图片并写入当前会话工作区：\n' + saved.map(x => '- ' + x.path).join('\n');
      },
      async sendWorkbenchImageMessage() {
        const content = String(this.imageWorkbenchPrompt || '').trim();
        if (!content) {
          U.toast('请先描述你想生成的图片');
          return;
        }
        this.sheet = '';
        await this.sendImageMessage(content);
      },
      async sendImageMessage(promptOverride) {
        const usingOverride = promptOverride != null;
        const content = String(usingOverride ? promptOverride : this.input).trim();
        if (!content) {
          U.toast('请先描述你想生成的图片');
          return;
        }
        try { this.imageRequestModel(); }
        catch (e) {
          U.toast(e.message || '请先配置图片生成模型', 3200);
          this.openSettings();
          return;
        }
        const user = {
          id: U.uuid(),
          role: 'user',
          content,
          attachments: clone(this.attachments),
          createdAt: U.now()
        };
        const referenceFiles = (this.attachments || [])
          .filter(a => a.kind === 'image' && a.path)
          .map(a => a.path);
        this.session.messages.push(user);
        if (!this.session.title && content) this.session.title = cleanTitle(content);
        const assistant = {
          id: U.uuid(),
          role: 'assistant',
          content: '',
          images: [],
          status: 'streaming',
          model: this.imageModelId,
          createdAt: U.now()
        };
        this.session.messages.push(assistant);
        const assistantMsg = this.session.messages[this.session.messages.length - 1];
        if (usingOverride) {
          this.imageWorkbenchPrompt = '';
          this.attachments = [];
          this.captureCurrentDraft();
        } else {
          this.clearCurrentDraft();
        }
        this.generating = true;
        this.requestNotificationPermission();
        this.stopRequested = false;
        this.abortCtl = new AbortController();
        this.persistSession();
        nextTick(() => {
          this.growInput();
          this.scrollToBottom(true);
        });
        try {
          await this.runImageRequest({
            prompt: content,
            source: 'image_mode',
            mode: referenceFiles.length ? 'edit' : 'generate',
            referenceFiles
          }, assistantMsg);
          assistantMsg.status = 'done';
        } catch (e) {
          assistantMsg.status = 'done';
          if (this.stopRequested || e && e.code === 'NET-ABORTED') {
            assistantMsg.content = assistantMsg.content || '已停止。';
          } else {
            const networkError = this.connectionError(e, '图片生成', e && e.code || 'IMAGE-SUBMIT-UNKNOWN');
            assistantMsg.error = this.connectionErrorText(networkError);
          }
        } finally {
          this.generating = false;
          this.abortCtl = null;
          this.stopRequested = false;
          this.clearRunningNotification();
          await this.flushSessionPersist(1200);
          nextTick(() => this.scrollToBottom(false));
        }
      },
      async sendMessage() {
        if (!this.canSend) return;
        if (this.appMode === 'image') {
          await this.sendImageMessage();
          return;
        }
        const provider = this.currentProvider;
        if (!provider) {
          U.toast('请先添加模型提供商');
          this.openSettings();
          return;
        }
        const model = this.settings.activeModel || this.session.model || provider.models[0] || '';
        if (!model) {
          U.toast('请先选择或填写模型');
          this.sheet = 'model';
          return;
        }
        const meta = providerModelMeta(provider, model);
        if (this.attachments.some(a => a.kind === 'image') && !(meta.capabilities && meta.capabilities.vision)) {
          U.toast('当前模型元数据未开启视觉能力，图片可能无法被理解', 3600);
        }
        const content = this.input.trim();
        const parentAssistant = this.session.messages.slice().reverse().find(m => m.role === 'assistant');
        const user = {
          id: U.uuid(),
          role: 'user',
          content,
          attachments: clone(this.attachments),
          createdAt: U.now(),
          parentAssistantId: parentAssistant && parentAssistant.id || '',
          parentVariantId: parentAssistant ? this.activeAssistantVariantId(parentAssistant) : ''
        };
        this.session.messages.push(user);
        if (!this.session.title && content) this.session.title = cleanTitle(content);
        this.session.providerId = provider.id;
        this.session.model = model;
        this.clearCurrentDraft();
        this.persistSession();
        nextTick(() => {
          this.growInput();
          this.scrollToBottom(true);
        });
        await this.generateAssistant();
      },
      async generateAssistant(opts) {
        opts = opts || {};
        const provider = this.currentProvider;
        const model = this.settings.activeModel || this.session.model || provider && provider.models[0] || '';
        if (!provider || !model) return;

        const targetIndex = Number.isInteger(opts.targetIndex) ? opts.targetIndex : -1;
        let assistantMsg;
        if (targetIndex >= 0) {
          assistantMsg = this.session.messages[targetIndex];
          if (!assistantMsg || assistantMsg.role !== 'assistant') return;
          const variants = this.ensureAssistantVariants(assistantMsg);
          const nextVariant = this.snapshotAssistantVariant({
            content: '', reasoning: '', toolCalls: [], previews: [], images: [], imageRecovery: null,
            error: '', usage: null, model, createdAt: U.now(), status: 'streaming'
          }, U.uuid());
          variants.push(nextVariant);
          assistantMsg.activeVariantIndex = variants.length - 1;
          this.applyAssistantVariant(assistantMsg, assistantMsg.activeVariantIndex);
          assistantMsg.status = 'streaming';
        } else {
          assistantMsg = {
            id: U.uuid(),
            role: 'assistant',
            content: '',
            reasoning: '',
            toolCalls: [],
            previews: [],
            status: 'streaming',
            model,
            createdAt: U.now()
          };
          assistantMsg.variantBaseId = assistantMsg.id + ':v1';
          this.session.messages.push(assistantMsg);
        }
        const assistantIndex = this.session.messages.indexOf(assistantMsg);
        const workingMessages = this.session.messages
          .slice(0, assistantIndex)
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => {
            if (m.role === 'assistant') {
              return { role: 'assistant', content: m.content || '', reasoning: m.reasoning || '' };
            }
            return clone(m);
          });
        const tools = this.settings.agentEnabled && API.supportsTools(provider) ? this.enabledTools() : [];
        const reqSettings = this.settingsForRequest(tools);

        this.generating = true;
        this.requestNotificationPermission();
        this.stopRequested = false;
        this.abortCtl = new AbortController();
        const maxToolRounds = U.clamp(parseInt(this.settings.maxToolRounds || 8, 10), 1, 32);
        const maxToolCalls = U.clamp(parseInt(this.settings.maxToolCalls || 24, 10), 1, 128);
        let totalToolCalls = 0;
        const previousToolResults = [];
        const usageTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: '' };
        // assistantMsg.content 由 smoothText 逐字动画显示；多轮工具调用时每个 step 的
        // onUpdate.st.content 是该 step 的完整正文（非增量），这里用 lastSeenLen 追增量累计成
        // 完整正文，避免后一轮覆盖前一轮、正文丢失。
        let accumulatedContent = '';
        let accumulatedReasoning = '';
        let stepSeenLen = 0;
        let stepSeenReasoningLen = 0;
        const addUsage = usage => {
          if (!usage) return;
          usageTotals.inputTokens += Number(usage.inputTokens) || 0;
          usageTotals.outputTokens += Number(usage.outputTokens) || 0;
          usageTotals.totalTokens += Number(usage.totalTokens) || 0;
          if (usage.source === 'api') usageTotals.source = 'api';
        };

        try {
          for (let step = 0; step <= maxToolRounds; step++) {
            const result = await API.send({
              provider,
              model,
              messages: workingMessages,
              tools,
              settings: reqSettings,
              signal: this.abortCtl.signal,
              requestKey: NetStability.idempotencyKey('chat-' + assistantMsg.id + '-' + step),
              onStatus: info => this.connectionStatus(Object.assign({ source: '模型提供商' }, info || {})),
              onUpdate: st => {
                // st.content / st.reasoning 是本 step 的完整正文；追增量拼入累计正文
                const sc = st.content || '';
                if (sc.length > stepSeenLen) { accumulatedContent += sc.slice(stepSeenLen); stepSeenLen = sc.length; }
                const sr = st.reasoning || '';
                if (sr.length > stepSeenReasoningLen) { accumulatedReasoning += sr.slice(stepSeenReasoningLen); stepSeenReasoningLen = sr.length; }
                smoothText(this, assistantMsg, accumulatedContent);
                assistantMsg.reasoning = accumulatedReasoning;
                if (st.streamTools && st.streamTools.length) syncStreamToolCalls(assistantMsg, st.streamTools, step);
                assistantMsg.status = 'streaming';
                if (assistantMsg.variants && assistantMsg.variants.length) this.syncActiveAssistantVariant(assistantMsg);
                nextTick(() => this.scrollToBottom(false));
              }
            });

            // 兜底：若当前 step 的完整正文还没被 onUpdate 累计（如整体返回 JSON），补上
            const rc = result.content || '';
            if (rc.length > stepSeenLen) { accumulatedContent += rc.slice(stepSeenLen); stepSeenLen = rc.length; }
            const rr = result.reasoning || '';
            if (rr.length > stepSeenReasoningLen) { accumulatedReasoning += rr.slice(stepSeenReasoningLen); stepSeenReasoningLen = rr.length; }
            smoothText(this, assistantMsg, accumulatedContent);
            assistantMsg.reasoning = accumulatedReasoning;
            addUsage(result.usage);
            stepSeenLen = 0;
            stepSeenReasoningLen = 0;

            if (this.stopRequested) {
              cancelStreamToolCalls(assistantMsg, step);
              break;
            }
            if (!tools.length || !result.toolCalls || !result.toolCalls.length) {
              discardStreamToolCalls(assistantMsg, step);
              break;
            }

            const rawCalls = result.toolCalls.filter(t => t && t.name);
            if (!rawCalls.length) {
              discardStreamToolCalls(assistantMsg, step);
              break;
            }
            if (step >= maxToolRounds) {
              discardStreamToolCalls(assistantMsg, step);
              assistantMsg.error = '已达到最大工具轮次（' + maxToolRounds + '）。可以在设置里调高“最大工具轮次”。';
              break;
            }
            if (totalToolCalls + rawCalls.length > maxToolCalls) {
              discardStreamToolCalls(assistantMsg, step);
              assistantMsg.error = '已达到最大工具调用数（' + maxToolCalls + '）。可以在设置里调高“最大工具调用数”。';
              break;
            }
            totalToolCalls += rawCalls.length;

            const displayCalls = finalizeStreamToolCalls(assistantMsg, rawCalls, step);
            workingMessages.push({
              role: 'assistant',
              content: accumulatedContent || result.content || '',
              toolCalls: rawCalls.map((t, idx) => ({
                id: t.id || displayCalls[idx].id,
                name: t.name,
                arguments: t.arguments || '{}'
              }))
            });
            if (assistantMsg.variants && assistantMsg.variants.length) this.syncActiveAssistantVariant(assistantMsg);
            this.persistSession();

            for (let ti = 0; ti < displayCalls.length; ti++) {
              const t = displayCalls[ti];
              const denied = await this.authorizeToolCall(t);
              const out = denied || await Tools.execute(t.name, t.arguments, {
                session: this.session,
                webFetchMode: 'always',
                previousResults: previousToolResults,
                confirm: msg => this.confirm(msg, '工具授权'),
                openPreview: payload => this.openPreview(payload),
                openService: serviceId => this.openServicePreview(serviceId),
                createPreviewCard: payload => this.createPreviewCard(payload, assistantMsg),
                imageGo: args => this.imageGoTool(args, assistantMsg)
              });
              t.result = out;
              t.status = String(out).startsWith('错误：') ? 'error' : 'done';
              previousToolResults.push({ name: t.name, result: out });
              workingMessages.push({ role: 'tool', toolCallId: t.id, content: out });
              if (assistantMsg.variants && assistantMsg.variants.length) this.syncActiveAssistantVariant(assistantMsg);
              this.persistSession();
              nextTick(() => this.scrollToBottom(false));
            }
          }
          if (!assistantMsg.content && !assistantMsg.toolCalls.length && this.stopRequested) smoothText(this, assistantMsg, '已停止。');
          await waitSmoothText(assistantMsg);
          assistantMsg.status = 'done';
          if (usageTotals.source === 'api' && (usageTotals.outputTokens || usageTotals.totalTokens)) {
            assistantMsg.usage = usageTotals;
          } else {
            assistantMsg.usage = {
              inputTokens: 0,
              outputTokens: MODEL_META.estimateTokens(tokenMessageText(assistantMsg)),
              totalTokens: MODEL_META.estimateTokens(tokenMessageText(assistantMsg)),
              source: 'estimate'
            };
          }
        } catch (e) {
          assistantMsg.status = 'done';
          if (this.stopRequested || e && e.code === 'NET-ABORTED') {
            if (!assistantMsg.content && !assistantMsg.toolCalls.length) assistantMsg.content = '已停止。';
          } else {
            const networkError = this.connectionError(e, '模型提供商');
            assistantMsg.error = this.connectionErrorText(networkError);
          }
        } finally {
          await waitSmoothText(assistantMsg);
          if (!assistantMsg.usage && (assistantMsg.content || assistantMsg.reasoning)) {
            const estimated = MODEL_META.estimateTokens(tokenMessageText(assistantMsg));
            assistantMsg.usage = { inputTokens: 0, outputTokens: estimated, totalTokens: estimated, source: 'estimate' };
          }
          if (assistantMsg.variants && assistantMsg.variants.length) this.syncActiveAssistantVariant(assistantMsg);
          this.generating = false;
          this.abortCtl = null;
          this.stopRequested = false;
          this.clearRunningNotification();
          await this.flushSessionPersist(1200);
          nextTick(() => this.scrollToBottom(false));
        }
      },
      stopGenerate() {
        if (!this.generating) return;
        this.stopRequested = true;
        if (this.abortCtl) {
          try { this.abortCtl.abort(); } catch (e) {}
        }
      },
  };
})();
