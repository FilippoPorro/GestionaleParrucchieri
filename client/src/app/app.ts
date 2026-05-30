import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AiChatDrawerComponent } from './features/ai-chat-drawer.component/ai-chat-drawer.component';
import { SeoService } from './services/seo';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AiChatDrawerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('client');

  constructor(seoService: SeoService) {
    seoService.init();
  }
}
