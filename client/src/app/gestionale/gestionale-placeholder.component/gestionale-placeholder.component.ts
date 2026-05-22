import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SidenavComponent } from '../sidenav.component/sidenav.component';

interface PlaceholderCard {
  title: string;
  text: string;
}

@Component({
  selector: 'app-gestionale-placeholder',
  standalone: true,
  imports: [CommonModule, SidenavComponent],
  templateUrl: './gestionale-placeholder.component.html',
  styleUrl: '../home.component/home.component.css',
})
export class GestionalePlaceholderComponent implements OnInit {
  isSidenavCollapsed = false;
  title = '';
  description = '';
  cards: PlaceholderCard[] = [];

  constructor(private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.data.subscribe((data) => {
      this.title = String(data['title'] ?? 'Sezione gestionale');
      this.description = String(data['description'] ?? 'Modulo in preparazione.');
      this.cards = (data['cards'] as PlaceholderCard[] | undefined) ?? [];
    });
  }

  toggleSidenav(): void {
    this.isSidenavCollapsed = !this.isSidenavCollapsed;
  }
}
