class ProfessionalWebCrawler {
    constructor() {
        this.visitedUrls = new Set();
        this.urlsToCrawl = new Set();
        this.failedUrls = new Set();
        this.isCrawling = false;
        this.isPaused = false;
        this.stats = {
            totalDiscovered: 0,
            successfullyCrawled: 0,
            failed: 0,
            duplicates: 0,
            external: 0
        };
        
        // Добавляем tracking времени
        this.timeTracking = {
            startTime: null,
            averageTimePerPage: 0,
            pageTimes: [],
            lastUpdateTime: null
        };
        
        this.config = {
            maxPages: 500,
            delay: 200,
            usePuppeteer: true
        };
    }

    async startCrawling(startUrl) {
        if (!this.isValidUrl(startUrl)) {
            throw new Error('Некорректный URL');
        }

        this.resetState();
        this.isCrawling = true;
        this.isPaused = false;
        
        // Инициализация отслеживания времени
        this.timeTracking.startTime = Date.now();
        this.timeTracking.lastUpdateTime = Date.now();
        this.timeTracking.pageTimes = [];
        this.timeTracking.averageTimePerPage = 0;
        
        const baseUrl = this.normalizeUrl(startUrl);
        this.urlsToCrawl.add(baseUrl);
        
        this.log('🚀 Запуск профессионального краулера...', 'info');
        this.log(`🎯 Цель: ${baseUrl}`, 'info');
        this.log(`📊 Лимит: ${this.config.maxPages} страниц`, 'info');

        try {
            await this.crawlAllPages(baseUrl);
            this.completeCrawling();
        } catch (error) {
            this.log(`❌ Ошибка: ${error.message}`, 'error');
            this.stopCrawling();
        }
    }

    async crawlAllPages(baseUrl) {
        while (this.urlsToCrawl.size > 0 && 
               this.isCrawling && 
               this.visitedUrls.size < this.config.maxPages) {
            
            if (this.isPaused) {
                await this.delay(100);
                continue;
            }

            const pageStartTime = Date.now();
            const currentUrl = Array.from(this.urlsToCrawl)[0];
            this.urlsToCrawl.delete(currentUrl);
            
            await this.crawlSinglePage(currentUrl, baseUrl);
            
            // Записываем время обработки страницы
            const pageTime = Date.now() - pageStartTime;
            this.recordPageTime(pageTime);
            
            this.updateProgress();
            
            await this.delay(this.config.delay);
        }
    }

    recordPageTime(pageTime) {
        this.timeTracking.pageTimes.push(pageTime);
        
        // Ограничиваем историю последними 50 страницами для актуальности
        if (this.timeTracking.pageTimes.length > 50) {
            this.timeTracking.pageTimes.shift();
        }
        
        // Пересчитываем среднее время
        const sum = this.timeTracking.pageTimes.reduce((a, b) => a + b, 0);
        this.timeTracking.averageTimePerPage = sum / this.timeTracking.pageTimes.length;
        
        this.timeTracking.lastUpdateTime = Date.now();
    }

    getTimeEstimate() {
        if (this.timeTracking.pageTimes.length < 5) {
            return { estimatedTime: 0, formatted: 'расчет...' };
        }

        const pagesProcessed = this.visitedUrls.size + this.failedUrls.size;
        const pagesRemaining = Math.min(
            this.urlsToCrawl.size,
            this.config.maxPages - pagesProcessed
        );

        if (pagesRemaining <= 0) {
            return { estimatedTime: 0, formatted: 'завершается...' };
        }

        // Расчет оставшегося времени
        const estimatedTimeMs = pagesRemaining * this.timeTracking.averageTimePerPage;
        
        return {
            estimatedTime: estimatedTimeMs,
            formatted: this.formatTime(estimatedTimeMs)
        };
    }

    getElapsedTime() {
        if (!this.timeTracking.startTime) return '0с';
        const elapsedMs = Date.now() - this.timeTracking.startTime;
        return this.formatTime(elapsedMs);
    }

    formatTime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}ч ${minutes % 60}м ${seconds % 60}с`;
        } else if (minutes > 0) {
            return `${minutes}м ${seconds % 60}с`;
        } else {
            return `${seconds}с`;
        }
    }

    getProgressData() {
        const pagesProcessed = this.visitedUrls.size + this.failedUrls.size;
        const progress = (pagesProcessed / this.config.maxPages) * 100;
        const timeEstimate = this.getTimeEstimate();
        const elapsedTime = this.getElapsedTime();
        
        return {
            progress: Math.min(progress, 100),
            stats: this.stats,
            visited: this.visitedUrls.size,
            queued: this.urlsToCrawl.size,
            failed: this.failedUrls.size,
            timeEstimate: timeEstimate.formatted,
            elapsedTime: elapsedTime,
            averageTime: Math.round(this.timeTracking.averageTimePerPage / 100) / 10, // в секундах
            pagesProcessed: pagesProcessed
        };
    }

    // Остальные методы остаются без изменений до updateProgress
    async crawlSinglePage(url, baseUrl) {
        if (this.visitedUrls.has(url)) return;
        
        this.visitedUrls.add(url);
        this.log(`📄 Обработка: ${url}`, 'crawl');

        try {
            let content, finalUrl;

            if (this.config.usePuppeteer && await this.isJavascriptSite(url)) {
                ({ content, finalUrl } = await this.fetchWithPuppeteer(url));
            } else {
                ({ content, finalUrl } = await this.fetchWithProxy(url));
            }

            // Обработка редиректов
            if (finalUrl !== url) {
                this.log(`🔄 Редирект: ${url} → ${finalUrl}`, 'redirect');
                this.stats.duplicates++;
            }

            this.stats.successfullyCrawled++;
            
            // Извлекаем ссылки
            const newUrls = this.extractUrlsFromHtml(content, finalUrl || url);
            this.processNewUrls(newUrls, baseUrl);

        } catch (error) {
            this.log(`❌ Ошибка: ${url} - ${error.message}`, 'error');
            this.failedUrls.add(url);
            this.stats.failed++;
        }
    }

    updateProgress() {
        const progressData = this.getProgressData();
        
        // Обновляем UI
        if (typeof updateUI === 'function') {
            updateUI(progressData);
        }
    }

    // ... остальные методы без изменений ...

    resetState() {
        this.visitedUrls.clear();
        this.urlsToCrawl.clear();
        this.failedUrls.clear();
        this.stats = {
            totalDiscovered: 0,
            successfullyCrawled: 0,
            failed: 0,
            duplicates: 0,
            external: 0
        };
        this.timeTracking = {
            startTime: null,
            averageTimePerPage: 0,
            pageTimes: [],
            lastUpdateTime: null
        };
    }
}
