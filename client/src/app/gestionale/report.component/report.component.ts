import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { SidenavComponent } from '../sidenav.component/sidenav.component';
import {
  DashboardService,
  ReportCustomerFrequencyDatum,
  ReportData
} from '../../services/dashboard';

Chart.register(...registerables);

type ReportPeriod = 30 | 90 | 365;

@Component({
  selector: 'app-report',
  standalone: true,
  imports: [CommonModule, SidenavComponent],
  templateUrl: './report.component.html',
  styleUrl: './report.component.css'
})
export class ReportComponent implements OnInit, AfterViewInit, OnDestroy {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  @ViewChild('categoryChart') private categoryChartRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('paymentsChart') private paymentsChartRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('trendChart') private trendChartRef?: ElementRef<HTMLCanvasElement>;

  private categoryChart?: Chart;
  private paymentsChart?: Chart;
  private trendChart?: Chart;
  private chartsReady = false;

  isSidenavCollapsed = false;
  loading = true;
  errorMessage = '';
  selectedPeriod: ReportPeriod = 90;
  reportData: ReportData | null = null;

  readonly periods: ReportPeriod[] = [30, 90, 365];
  readonly reportPalette = ['#d7b06f', '#8fb79d', '#6f8f7d', '#f0d9a7', '#4f6f5f', '#b78444'];

  ngOnInit(): void {
    this.loadReport();
  }

  ngAfterViewInit(): void {
    this.chartsReady = true;
    this.renderCharts();
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }

  toggleSidenav(): void {
    this.isSidenavCollapsed = !this.isSidenavCollapsed;
  }

  selectPeriod(period: ReportPeriod): void {
    if (this.loading || this.selectedPeriod === period) {
      return;
    }

    this.selectedPeriod = period;
    this.loadReport();
  }

  get customerFrequencyRows(): ReportCustomerFrequencyDatum[] {
    return this.reportData?.customers.frequency || [];
  }

  get cardPercentage(): string {
    const total = this.reportData?.payments.total || 0;
    const card = this.reportData?.payments.card || 0;
    return total > 0 ? `${((card / total) * 100).toFixed(1)}%` : '0%';
  }

  get cashPercentage(): string {
    const total = this.reportData?.payments.total || 0;
    const cash = this.reportData?.payments.cash || 0;
    return total > 0 ? `${((cash / total) * 100).toFixed(1)}%` : '0%';
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 2
    }).format(value || 0);
  }

  private loadReport(): void {
    this.loading = true;
    this.errorMessage = '';

    this.dashboardService.getReport(this.selectedPeriod).subscribe({
      next: (reportData) => {
        this.reportData = reportData;
        this.loading = false;
        this.cdr.detectChanges();
        this.renderCharts();
      },
      error: (error) => {
        console.error('Errore caricamento report:', error);
        this.reportData = null;
        this.loading = false;
        this.errorMessage = 'Non sono riuscito a caricare il report.';
        this.destroyCharts();
        this.cdr.detectChanges();
      }
    });
  }

  private renderCharts(): void {
    if (!this.chartsReady || !this.reportData) {
      return;
    }

    this.destroyCharts();
    this.categoryChart = this.createCategoryChart();
    this.paymentsChart = this.createPaymentsChart();
    this.trendChart = this.createTrendChart();
  }

  private destroyCharts(): void {
    this.categoryChart?.destroy();
    this.paymentsChart?.destroy();
    this.trendChart?.destroy();
    this.categoryChart = undefined;
    this.paymentsChart = undefined;
    this.trendChart = undefined;
  }

  private createCategoryChart(): Chart | undefined {
    const canvas = this.categoryChartRef?.nativeElement;
    const data = this.reportData?.charts.revenueByCategory || [];
    if (!canvas || data.length === 0) {
      return undefined;
    }

    const config: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        labels: data.map((item) => item.label),
        datasets: [{
          data: data.map((item) => item.value),
          backgroundColor: data.map((_, index) => this.reportPalette[index % this.reportPalette.length]),
          borderWidth: 0,
          hoverOffset: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: 'rgba(248, 241, 231, 0.82)',
              usePointStyle: true,
              padding: 18
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            titleColor: '#fff4d8',
            bodyColor: '#f3dfb3',
            callbacks: {
              label: (context) => {
                const value = Number(context.parsed || 0);
                const total = data.reduce((sum, item) => sum + item.value, 0);
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                return `${context.label}: ${this.formatCurrency(value)} (${percentage}%)`;
              }
            }
          }
        }
      }
    };

    return new Chart(canvas, config);
  }

  private createPaymentsChart(): Chart | undefined {
    const canvas = this.paymentsChartRef?.nativeElement;
    const data = this.reportData?.charts.paymentDistribution || [];
    if (!canvas || data.length === 0) {
      return undefined;
    }

    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: data.map((item) => item.label),
        datasets: [{
          label: 'Incassi',
          data: data.map((item) => item.value),
          backgroundColor: ['#d7b06f', '#8fb79d'],
          borderRadius: 10,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            titleColor: '#fff4d8',
            bodyColor: '#f3dfb3',
            callbacks: {
              label: (context) => this.formatCurrency(Number(context.parsed.y || 0))
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: 'rgba(248, 241, 231, 0.72)',
              callback: (value) => this.formatCurrency(Number(value))
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.08)'
            },
            border: {
              color: 'rgba(255, 255, 255, 0.08)'
            }
          },
          x: {
            ticks: {
              color: 'rgba(248, 241, 231, 0.72)'
            },
            grid: {
              display: false
            },
            border: {
              color: 'rgba(255, 255, 255, 0.08)'
            }
          }
        }
      }
    };

    return new Chart(canvas, config);
  }

  private createTrendChart(): Chart | undefined {
    const canvas = this.trendChartRef?.nativeElement;
    const data = this.reportData?.charts.weeklyRevenueTrend || [];
    if (!canvas || data.length === 0) {
      return undefined;
    }

    const config: ChartConfiguration<'scatter'> = {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Incassi settimanali',
          data: data.map((item, index) => ({
            x: index + 1,
            y: item.value
          })),
          showLine: true,
          borderColor: '#d7b06f',
          backgroundColor: 'rgba(215, 176, 111, 0.18)',
          pointBackgroundColor: '#d7b06f',
          pointBorderColor: '#d7b06f',
          pointRadius: 6,
          pointHoverRadius: 8
          ,
          pointBorderWidth: 0,
          borderWidth: 2,
          fill: false,
          tension: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            titleColor: '#fff4d8',
            bodyColor: '#f3dfb3',
            callbacks: {
              title: (items) => {
                const index = (items[0]?.parsed.x || 1) - 1;
                return data[index]?.label || '';
              },
              label: (context) => {
                const index = Number(context.parsed.x) - 1;
                const point = data[index];
                if (!point) {
                  return this.formatCurrency(Number(context.parsed.y || 0));
                }

                const deltaLabel = point.delta >= 0 ? `+${this.formatCurrency(point.delta)}` : this.formatCurrency(point.delta);
                return `Incasso ${this.formatCurrency(point.value)} | Delta ${deltaLabel}`;
              }
            }
          },
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            ticks: {
              color: 'rgba(248, 241, 231, 0.72)',
              callback: (value) => {
                const index = Number(value) - 1;
                return index >= 0 ? `Set ${Number(value)}` : '';
              }
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.05)'
            },
            border: {
              color: 'rgba(255, 255, 255, 0.08)'
            }
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: 'rgba(248, 241, 231, 0.72)',
              callback: (value) => this.formatCurrency(Number(value))
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.08)'
            },
            border: {
              color: 'rgba(255, 255, 255, 0.08)'
            }
          }
        }
      }
    };

    return new Chart(canvas, config);
  }
}
