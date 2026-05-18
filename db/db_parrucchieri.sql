-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Creato il: Feb 13, 2026 alle 10:31
-- Versione del server: 10.4.32-MariaDB
-- Versione PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `db_parrucchieri`
--

-- --------------------------------------------------------

--
-- Struttura della tabella `appuntamenti`
--

CREATE TABLE `appuntamenti` (
  `idAppuntamento` int(11) NOT NULL,
  `idCliente` int(11) DEFAULT NULL,
  `idOperatore` int(11) NOT NULL,
  `dataOraInizio` datetime NOT NULL,
  `dataOraFine` datetime NOT NULL,
  `stato` enum('prenotato','in corso','completato') DEFAULT 'prenotato',
  `note` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `appuntamentiservizi`
--

CREATE TABLE `appuntamentiservizi` (
  `id` int(11) NOT NULL,
  `idAppuntamento` int(11) NOT NULL,
  `idServizio` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `dettagliovendita`
--

CREATE TABLE `dettagliovendita` (
  `id` int(11) NOT NULL,
  `idVendita` int(11) NOT NULL,
  `idProdotto` int(11) NOT NULL,
  `quantita` int(11) NOT NULL,
  `prezzoUnitario` decimal(8,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `fornitori`
--

CREATE TABLE `fornitori` (
  `idFornitore` int(11) NOT NULL,
  `nome` varchar(150) NOT NULL,
  `telefono` varchar(20) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `partitaIva` varchar(10) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `ordini`
--

CREATE TABLE `ordini` (
  `idOrdine` int(11) NOT NULL,
  `idFornitore` int(11) NOT NULL,
  `data` datetime NOT NULL,
  `stato` enum('in attesa','spedito','ricevuto') DEFAULT 'in attesa'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `pagamenti`
--

CREATE TABLE `pagamenti` (
  `idPagamento` int(11) NOT NULL,
  `idVendita` int(11) NOT NULL,
  `metodo` enum('contanti','carta','satispay') NOT NULL,
  `importo` decimal(10,2) NOT NULL,
  `data` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `prodotti`
--

CREATE TABLE `prodotti` (
  `idProdotto` int(11) NOT NULL,
  `foto` varchar(255) DEFAULT NULL,
  `nome` varchar(150) NOT NULL,
  `descrizione` text DEFAULT NULL,
  `prezzo` decimal(8,2) NOT NULL,
  `quantitaMagazzino` int(11) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `servizi`
--

CREATE TABLE `servizi` (
  `idServizio` int(11) NOT NULL,
  `nome` varchar(150) NOT NULL,
  `descrizione` text DEFAULT NULL,
  `durata` int(11) NOT NULL,
  `prezzo` decimal(8,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `utenti`
--

CREATE TABLE `utenti` (
  `idUtente` int(11) NOT NULL,
  `nome` varchar(100) NOT NULL,
  `cognome` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `telefono` varchar(20) DEFAULT NULL,
  `data_nascita` date DEFAULT NULL,
  `ruolo` enum('cliente','operatore','admin','salone') NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dump dei dati per la tabella `utenti`
--

INSERT INTO `utenti` (`idUtente`, `nome`, `cognome`, `email`, `password`, `telefono`, `data_nascita`, `ruolo`) VALUES
(1, 'Giuseppe', 'Porro', 'beppeporro72@gmail.com', 'JSON.parse();', '+39 3393652037', '1972-04-22', 'admin');

-- --------------------------------------------------------

--
-- Struttura della tabella `vendite`
--

CREATE TABLE `vendite` (
  `idVendita` int(11) NOT NULL,
  `idCliente` int(11) DEFAULT NULL,
  `data` datetime NOT NULL,
  `totale` decimal(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Indici per le tabelle scaricate
--

--
-- Indici per le tabelle `appuntamenti`
--
ALTER TABLE `appuntamenti`
  ADD PRIMARY KEY (`idAppuntamento`),
  ADD KEY `idCliente` (`idCliente`),
  ADD KEY `idOperatore` (`idOperatore`);

--
-- Indici per le tabelle `appuntamentiservizi`
--
ALTER TABLE `appuntamentiservizi`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idAppuntamento` (`idAppuntamento`),
  ADD KEY `idServizio` (`idServizio`);

--
-- Indici per le tabelle `dettagliovendita`
--
ALTER TABLE `dettagliovendita`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idVendita` (`idVendita`),
  ADD KEY `idProdotto` (`idProdotto`);

--
-- Indici per le tabelle `fornitori`
--
ALTER TABLE `fornitori`
  ADD PRIMARY KEY (`idFornitore`),
  ADD UNIQUE KEY `partitaIva` (`partitaIva`);

--
-- Indici per le tabelle `ordini`
--
ALTER TABLE `ordini`
  ADD PRIMARY KEY (`idOrdine`),
  ADD KEY `idFornitore` (`idFornitore`);

--
-- Indici per le tabelle `pagamenti`
--
ALTER TABLE `pagamenti`
  ADD PRIMARY KEY (`idPagamento`),
  ADD KEY `idVendita` (`idVendita`);

--
-- Indici per le tabelle `prodotti`
--
ALTER TABLE `prodotti`
  ADD PRIMARY KEY (`idProdotto`);

--
-- Indici per le tabelle `servizi`
--
ALTER TABLE `servizi`
  ADD PRIMARY KEY (`idServizio`);

--
-- Indici per le tabelle `utenti`
--
ALTER TABLE `utenti`
  ADD PRIMARY KEY (`idUtente`),
  ADD UNIQUE KEY `email` (`email`);

--
-- Indici per le tabelle `vendite`
--
ALTER TABLE `vendite`
  ADD PRIMARY KEY (`idVendita`),
  ADD KEY `idCliente` (`idCliente`);

--
-- AUTO_INCREMENT per le tabelle scaricate
--

--
-- AUTO_INCREMENT per la tabella `appuntamenti`
--
ALTER TABLE `appuntamenti`
  MODIFY `idAppuntamento` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `appuntamentiservizi`
--
ALTER TABLE `appuntamentiservizi`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `dettagliovendita`
--
ALTER TABLE `dettagliovendita`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `fornitori`
--
ALTER TABLE `fornitori`
  MODIFY `idFornitore` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `ordini`
--
ALTER TABLE `ordini`
  MODIFY `idOrdine` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `pagamenti`
--
ALTER TABLE `pagamenti`
  MODIFY `idPagamento` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `prodotti`
--
ALTER TABLE `prodotti`
  MODIFY `idProdotto` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `servizi`
--
ALTER TABLE `servizi`
  MODIFY `idServizio` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `utenti`
--
ALTER TABLE `utenti`
  MODIFY `idUtente` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT per la tabella `vendite`
--
ALTER TABLE `vendite`
  MODIFY `idVendita` int(11) NOT NULL AUTO_INCREMENT;

--
-- Limiti per le tabelle scaricate
--

--
-- Limiti per la tabella `appuntamenti`
--
ALTER TABLE `appuntamenti`
  ADD CONSTRAINT `appuntamenti_ibfk_1` FOREIGN KEY (`idCliente`) REFERENCES `utenti` (`idUtente`),
  ADD CONSTRAINT `appuntamenti_ibfk_2` FOREIGN KEY (`idOperatore`) REFERENCES `utenti` (`idUtente`);

--
-- Limiti per la tabella `appuntamentiservizi`
--
ALTER TABLE `appuntamentiservizi`
  ADD CONSTRAINT `appuntamentiservizi_ibfk_1` FOREIGN KEY (`idAppuntamento`) REFERENCES `appuntamenti` (`idAppuntamento`) ON DELETE CASCADE,
  ADD CONSTRAINT `appuntamentiservizi_ibfk_2` FOREIGN KEY (`idServizio`) REFERENCES `servizi` (`idServizio`);

--
-- Limiti per la tabella `dettagliovendita`
--
ALTER TABLE `dettagliovendita`
  ADD CONSTRAINT `dettagliovendita_ibfk_1` FOREIGN KEY (`idVendita`) REFERENCES `vendite` (`idVendita`) ON DELETE CASCADE,
  ADD CONSTRAINT `dettagliovendita_ibfk_2` FOREIGN KEY (`idProdotto`) REFERENCES `prodotti` (`idProdotto`);

--
-- Limiti per la tabella `ordini`
--
ALTER TABLE `ordini`
  ADD CONSTRAINT `ordini_ibfk_1` FOREIGN KEY (`idFornitore`) REFERENCES `fornitori` (`idFornitore`);

--
-- Limiti per la tabella `pagamenti`
--
ALTER TABLE `pagamenti`
  ADD CONSTRAINT `pagamenti_ibfk_1` FOREIGN KEY (`idVendita`) REFERENCES `vendite` (`idVendita`);

--
-- Limiti per la tabella `vendite`
--
ALTER TABLE `vendite`
  ADD CONSTRAINT `vendite_ibfk_1` FOREIGN KEY (`idCliente`) REFERENCES `utenti` (`idUtente`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
